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
/**
 * Check if a job has been cancelled by the user.
 */
async function isJobCancelled(chunkJobId: string): Promise<boolean> {
  const [job] = await db
    .select({ status: chunkJobs.status })
    .from(chunkJobs)
    .where(eq(chunkJobs.id, chunkJobId))
    .limit(1);
  return job?.status === "cancelled";
}

export async function processChunksInParallel(
  chunkJobId: string,
  chunkInputs: ChunkInput[],
  instruction: string,
  model: string,
  totalChunks: number,
  maxOutputTokens?: number
): Promise<ChunkResult[]> {
  const results: (ChunkResult | undefined)[] = new Array(chunkInputs.length);
  let activeCount = 0;
  let nextIndex = 0;
  let cancelled = false;

  return new Promise((resolve) => {
    async function startNext() {
      // Check for cancellation before launching new chunks
      if (!cancelled && nextIndex < chunkInputs.length) {
        cancelled = await isJobCancelled(chunkJobId);
        if (cancelled) {
          // Mark remaining chunks as cancelled results
          for (let i = nextIndex; i < chunkInputs.length; i++) {
            if (!results[i]) {
              results[i] = {
                index: chunkInputs[i].index,
                output: "",
                tokens: 0,
                cost: 0,
                status: "failed",
                error: "Cancelled by user",
              };
            }
          }
          checkDone();
          return;
        }
      }

      while (activeCount < MAX_CONCURRENCY && nextIndex < chunkInputs.length && !cancelled) {
        const chunk = chunkInputs[nextIndex];
        const currentIdx = nextIndex;
        nextIndex++;
        activeCount++;

        processOneChunk(chunkJobId, chunk, instruction, model, totalChunks, maxOutputTokens)
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
  totalChunks: number,
  maxOutputTokens?: number
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
      const response = await chatCompletion(model, messages, maxOutputTokens);

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
 * Stitch chunk outputs into a cohesive result.
 *
 * IMPORTANT: If the total output exceeds the model's maxOutput token limit,
 * stitching is SKIPPED to avoid content loss. A stitch pass that can't reproduce
 * the full output would truncate the translation.
 */
export async function stitchResults(
  chunkOutputs: string[],
  instruction: string,
  model: string,
  contextLength: number,
  maxOutputTokens?: number
): Promise<{ output: string; tokens: number; cost: number }> {
  if (chunkOutputs.length <= 1) {
    return { output: chunkOutputs[0] ?? "", tokens: 0, cost: 0 };
  }

  // Check if total output exceeds what the model can produce in one call.
  // If so, skip stitching entirely to avoid truncating the content.
  const totalOutputTokens = chunkOutputs.reduce(
    (sum, o) => sum + Math.ceil(o.length / 4),
    0
  );
  const effectiveMaxOutput = maxOutputTokens ?? Math.floor(contextLength * 0.5);

  if (totalOutputTokens > effectiveMaxOutput * 0.9) {
    // Content too large to stitch without losing data — just concatenate
    console.log(
      `Skipping stitch: total output ~${totalOutputTokens} tokens exceeds max output ~${effectiveMaxOutput}. Concatenating instead.`
    );
    return {
      output: chunkOutputs.join("\n\n"),
      tokens: 0,
      cost: 0,
    };
  }

  // Total output fits — do a single stitch pass
  return doStitch(chunkOutputs, instruction, model, maxOutputTokens);
}

async function doStitch(
  outputs: string[],
  instruction: string,
  model: string,
  maxOutputTokens?: number
): Promise<{ output: string; tokens: number; cost: number }> {
  const combinedText = outputs.join("\n\n---CHUNK BOUNDARY---\n\n");

  const messages: OpenRouterMessage[] = [
    {
      role: "system",
      content: `You previously processed a large document in ${outputs.length} chunks with this instruction: "${instruction}"\n\nBelow are the outputs from each chunk, separated by "---CHUNK BOUNDARY---". Smooth the transitions between chunks, remove any redundancies at boundaries, and produce a single cohesive output. Do not add new content; only refine the seams between chunks. You MUST reproduce the COMPLETE text — do not summarize or truncate.`,
    },
    {
      role: "user",
      content: combinedText,
    },
  ];

  const response = await chatCompletion(model, messages, maxOutputTokens);

  return {
    output: response.choices[0]?.message?.content ?? combinedText,
    tokens: response.usage?.total_tokens ?? 0,
    cost: response.usage?.cost ?? 0,
  };
}
