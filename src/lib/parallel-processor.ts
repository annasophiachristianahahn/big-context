import type { ChunkInput, ChunkResult, OpenRouterMessage } from "@/types";
import { chatCompletion } from "./openrouter";
import { db } from "./db";
import { chunks, chunkJobs } from "./db/schema";
import { eq, and, sql } from "drizzle-orm";

const MAX_CONCURRENCY = 5;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/**
 * Process chunks in parallel with controlled concurrency.
 * Updates database as each chunk completes.
 */
export async function processChunksInParallel(
  chunkJobId: string,
  chunkInputs: ChunkInput[],
  instruction: string,
  model: string,
  totalChunks: number
): Promise<ChunkResult[]> {
  const results: (ChunkResult | undefined)[] = new Array(chunkInputs.length);
  let activeCount = 0;
  let nextIndex = 0;

  return new Promise((resolve) => {
    function startNext() {
      while (activeCount < MAX_CONCURRENCY && nextIndex < chunkInputs.length) {
        const chunk = chunkInputs[nextIndex];
        const currentIdx = nextIndex;
        nextIndex++;
        activeCount++;

        processOneChunk(chunkJobId, chunk, instruction, model, totalChunks)
          .then((result) => {
            results[currentIdx] = result;
            activeCount--;
            checkDone();
            startNext();
          })
          .catch((error) => {
            results[currentIdx] = {
              index: chunk.index,
              output: "",
              tokens: 0,
              cost: 0,
              status: "failed",
              error: error.message,
            };
            activeCount--;
            checkDone();
            startNext();
          });
      }
    }

    function checkDone() {
      if (results.every((r) => r !== undefined)) {
        resolve(results as ChunkResult[]);
      }
    }

    startNext();
  });
}

async function processOneChunk(
  chunkJobId: string,
  chunk: ChunkInput,
  instruction: string,
  model: string,
  totalChunks: number
): Promise<ChunkResult> {
  // Find the DB chunk record
  const dbChunks = await db
    .select()
    .from(chunks)
    .where(and(eq(chunks.chunkJobId, chunkJobId), eq(chunks.index, chunk.index)))
    .limit(1);

  const dbChunk = dbChunks[0];
  if (!dbChunk) throw new Error(`Chunk record not found: ${chunk.index}`);

  // Mark as processing
  await db
    .update(chunks)
    .set({ status: "processing" })
    .where(eq(chunks.id, dbChunk.id));

  const messages: OpenRouterMessage[] = [
    {
      role: "system",
      content: `You are a helpful assistant processing a large document in chunks. Your task:\n\n${instruction}\n\nIMPORTANT: You are processing chunk ${chunk.index + 1} of ${totalChunks}. Process ONLY the text provided below according to the instruction. Do not add introductions or conclusions unless this is the first or last chunk respectively. Maintain consistency with the processing of other chunks.`,
    },
    {
      role: "user",
      content: chunk.text,
    },
  ];

  // Retry with exponential backoff
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await chatCompletion(model, messages);

      const output = response.choices[0]?.message?.content ?? "";
      const usage = response.usage;
      const tokens = usage?.total_tokens ?? 0;
      const cost = usage?.cost ?? 0;

      // Update chunk record
      await db
        .update(chunks)
        .set({
          outputText: output,
          status: "completed",
          tokens,
          cost,
        })
        .where(eq(chunks.id, dbChunk.id));

      // Increment completed count
      await db
        .update(chunkJobs)
        .set({
          completedChunks: sql`${chunkJobs.completedChunks} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(chunkJobs.id, chunkJobId));

      return {
        index: chunk.index,
        output,
        tokens,
        cost,
        status: "completed",
      };
    } catch (error) {
      lastError = error as Error;
      const isRateLimit =
        lastError.message.includes("429") ||
        lastError.message.includes("rate");
      if (isRateLimit && attempt < MAX_RETRIES - 1) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      break;
    }
  }

  // Mark as failed
  await db
    .update(chunks)
    .set({
      status: "failed",
      error: lastError?.message ?? "Unknown error",
    })
    .where(eq(chunks.id, dbChunk.id));

  // Still increment completed count (failed counts as processed)
  await db
    .update(chunkJobs)
    .set({
      completedChunks: sql`${chunkJobs.completedChunks} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(chunkJobs.id, chunkJobId));

  return {
    index: chunk.index,
    output: "",
    tokens: 0,
    cost: 0,
    status: "failed",
    error: lastError?.message,
  };
}

/**
 * Recursive stitching: combines chunk outputs, handling arbitrarily large results.
 * Groups outputs into batches that fit within the model's context, stitches each batch,
 * then recursively stitches the intermediate results.
 */
export async function stitchResults(
  chunkOutputs: string[],
  instruction: string,
  model: string,
  contextLength: number
): Promise<{ output: string; tokens: number; cost: number }> {
  if (chunkOutputs.length <= 1) {
    return { output: chunkOutputs[0] ?? "", tokens: 0, cost: 0 };
  }

  // Estimate how many outputs fit in one stitch call
  const maxStitchInputTokens = Math.floor(contextLength * 0.5);
  const batches: string[][] = [];
  let currentBatch: string[] = [];
  let currentTokens = 0;

  for (const output of chunkOutputs) {
    const outputTokens = Math.ceil(output.length / 4);
    if (
      currentTokens + outputTokens > maxStitchInputTokens &&
      currentBatch.length > 0
    ) {
      batches.push(currentBatch);
      currentBatch = [];
      currentTokens = 0;
    }
    currentBatch.push(output);
    currentTokens += outputTokens;
  }
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  // If everything fits in one batch, do a single stitch
  if (batches.length === 1) {
    return doStitch(batches[0], instruction, model);
  }

  // Otherwise, stitch each batch then recursively stitch the results
  let totalTokens = 0;
  let totalCost = 0;
  const intermediateResults: string[] = [];

  for (const batch of batches) {
    const result = await doStitch(batch, instruction, model);
    intermediateResults.push(result.output);
    totalTokens += result.tokens;
    totalCost += result.cost;
  }

  // Recursively stitch intermediate results
  const finalResult = await stitchResults(
    intermediateResults,
    instruction,
    model,
    contextLength
  );

  return {
    output: finalResult.output,
    tokens: totalTokens + finalResult.tokens,
    cost: totalCost + finalResult.cost,
  };
}

async function doStitch(
  outputs: string[],
  instruction: string,
  model: string
): Promise<{ output: string; tokens: number; cost: number }> {
  const combinedText = outputs.join("\n\n---CHUNK BOUNDARY---\n\n");

  const messages: OpenRouterMessage[] = [
    {
      role: "system",
      content: `You previously processed a large document in ${outputs.length} chunks with this instruction: "${instruction}"\n\nBelow are the outputs from each chunk, separated by "---CHUNK BOUNDARY---". Smooth the transitions between chunks, remove any redundancies at boundaries, and produce a single cohesive output. Do not add new content; only refine the seams between chunks.`,
    },
    {
      role: "user",
      content: combinedText,
    },
  ];

  const response = await chatCompletion(model, messages);

  return {
    output: response.choices[0]?.message?.content ?? combinedText,
    tokens: response.usage?.total_tokens ?? 0,
    cost: response.usage?.cost ?? 0,
  };
}
