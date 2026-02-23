import type { ChunkInput, ChunkResult, OpenRouterMessage } from "@/types";
import { chatCompletion } from "./openrouter";
import { estimateTokens } from "./token-estimator";
import { db } from "./db";
import { chunks, chunkJobs } from "./db/schema";
import { eq, and, sql } from "drizzle-orm";

const MAX_CONCURRENCY = 5;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

// Structured logging prefix for easy filtering in Railway logs
const LOG = "[BigContext:Processor]";

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
  console.log(`${LOG} === STARTING JOB ${chunkJobId} ===`);
  console.log(`${LOG} chunks=${chunkInputs.length}, model=${model}, maxOutput=${maxOutputTokens}`);
  console.log(`${LOG} instruction (first 200): ${instruction.slice(0, 200)}`);

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
            console.log(`${LOG} Chunk ${chunk.index} done: status=${result.status}, output=${result.output.length}chars, tokens=${result.tokens}, active=${activeCount}`);
            checkDone();
            startNext();
          })
          .catch((error) => {
            console.error(`${LOG} Chunk ${chunk.index} UNHANDLED ERROR:`, error.message);
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
      const done = results.filter(r => r !== undefined).length;
      if (done === chunkInputs.length) {
        const succeeded = results.filter(r => r?.status === "completed").length;
        const failed = results.filter(r => r?.status === "failed").length;
        console.log(`${LOG} === ALL CHUNKS DONE: ${succeeded} succeeded, ${failed} failed ===`);
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
  const chunkTag = `[Chunk ${chunk.index}/${totalChunks}]`;
  console.log(`${LOG} ${chunkTag} START: input=${chunk.text.length} chars (~${estimateTokens(chunk.text)} tokens)`);

  // Find the DB chunk record
  const dbChunks = await db
    .select()
    .from(chunks)
    .where(and(eq(chunks.chunkJobId, chunkJobId), eq(chunks.index, chunk.index)))
    .limit(1);

  const dbChunk = dbChunks[0];
  if (!dbChunk) {
    console.error(`${LOG} ${chunkTag} DB record NOT FOUND!`);
    throw new Error(`Chunk record not found: ${chunk.index}`);
  }

  // Mark as processing
  await db
    .update(chunks)
    .set({ status: "processing" })
    .where(eq(chunks.id, dbChunk.id));

  // Build a clear, non-ambiguous prompt that won't confuse models into
  // thinking this is an interactive multi-turn chunking conversation.
  const isFirst = chunk.index === 0;
  const isLast = chunk.index === totalChunks - 1;
  const isOnly = totalChunks === 1;

  let positionNote = "";
  if (isOnly) {
    positionNote = "This is the complete text.";
  } else if (isFirst) {
    positionNote = `This is the BEGINNING of a longer document (section ${chunk.index + 1} of ${totalChunks}). The text may start mid-context — that is expected.`;
  } else if (isLast) {
    positionNote = `This is the END of a longer document (section ${chunk.index + 1} of ${totalChunks}). The text may end abruptly — that is expected.`;
  } else {
    positionNote = `This is section ${chunk.index + 1} of ${totalChunks} from a longer document. The text may start and end mid-sentence — that is expected.`;
  }

  // "BOOKEND" prompt strategy: instruction appears BEFORE and AFTER the text.
  // With 100K+ chars of non-English text, models (especially Gemini via OpenRouter)
  // can "lose" the instruction in the massive context. Repeating it after the text
  // ensures the model remembers what to do even after processing all the input.
  const messages: OpenRouterMessage[] = [
    {
      role: "system",
      content: `You are a document processor. Your ONLY job is to apply the user's instruction to the provided text. ${positionNote}\n\nCRITICAL RULES:\n- The user's instruction is your HIGHEST PRIORITY — follow it exactly, including its style, format, voice, and level of detail\n- Do NOT add anything the user didn't ask for (e.g. preambles like "Here is the result")\n- Do NOT ask for more input or say "provide the next chunk"\n- If the instruction says to translate, you MUST translate — never output the original language\n- If the instruction asks you to extract or quote from the text, PREFER DIRECT QUOTATION from the source over paraphrase or summary\n- Do NOT add your own commentary explaining why something is interesting (e.g. "This demonstrates..." or "This highlights..." or "This is significant because..."). Let the source material speak for itself.\n- Use generous visual formatting: insert multiple blank lines between entries, sections, and major items so they are clearly separated and easy to scan\n- Follow the user's formatting instructions precisely`,
    },
    {
      role: "user",
      content: `=== YOUR TASK ===\n${instruction}\n=== END TASK ===\n\n${positionNote}\n\nApply the task above to ALL of the text below:\n\n=== DOCUMENT TEXT ===\n${chunk.text}\n=== END DOCUMENT TEXT ===\n\nREMINDER: Apply the task described at the top of this message. Follow the user's instructions exactly. Prefer direct quotation from the source over paraphrase. Do NOT add commentary explaining why something is interesting — let the material speak for itself.`,
    },
  ];

  console.log(`${LOG} ${chunkTag} System msg: ${messages[0].content.slice(0, 150)}...`);
  console.log(`${LOG} ${chunkTag} User msg (first 300): ${messages[1].content.slice(0, 300)}...`);
  console.log(`${LOG} ${chunkTag} User msg total: ${messages[1].content.length} chars`);

  // Retry with exponential backoff
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      console.log(`${LOG} ${chunkTag} API attempt ${attempt + 1}/${MAX_RETRIES}, model=${model}, maxTokens=${maxOutputTokens}`);
      const apiStart = Date.now();

      const response = await chatCompletion(model, messages, maxOutputTokens);

      const apiMs = Date.now() - apiStart;
      const output = response.choices[0]?.message?.content ?? "";
      const finishReason = response.choices[0]?.finish_reason ?? "unknown";
      const usage = response.usage;
      const tokens = usage?.total_tokens ?? 0;
      const cost = usage?.cost ?? 0;

      console.log(`${LOG} ${chunkTag} API response: ${apiMs}ms, output=${output.length}chars, tokens=${tokens}, cost=$${cost.toFixed(4)}, finish=${finishReason}`);
      console.log(`${LOG} ${chunkTag} Output preview: ${output.slice(0, 300)}`);

      if (output.length === 0) {
        console.warn(`${LOG} ${chunkTag} WARNING: Empty output from model!`);
      }

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

      console.log(`${LOG} ${chunkTag} DB updated: completed, counter incremented`);

      return {
        index: chunk.index,
        output,
        tokens,
        cost,
        status: "completed",
      };
    } catch (error) {
      lastError = error as Error;
      console.error(`${LOG} ${chunkTag} API error (attempt ${attempt + 1}): ${lastError.message.slice(0, 500)}`);

      const isRateLimit =
        lastError.message.includes("429") ||
        lastError.message.includes("rate");
      if (isRateLimit && attempt < MAX_RETRIES - 1) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        console.log(`${LOG} ${chunkTag} Rate limited, retry in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      break;
    }
  }

  // Mark as failed
  console.error(`${LOG} ${chunkTag} FAILED after ${MAX_RETRIES} attempts: ${lastError?.message}`);

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
  console.log(`${LOG} Stitch: ${chunkOutputs.length} outputs, totalChars=${chunkOutputs.reduce((s, o) => s + o.length, 0)}`);

  if (chunkOutputs.length <= 1) {
    console.log(`${LOG} Stitch: single output, skipping`);
    return { output: chunkOutputs[0] ?? "", tokens: 0, cost: 0 };
  }

  const totalOutputTokens = chunkOutputs.reduce(
    (sum, o) => sum + estimateTokens(o),
    0
  );
  const effectiveMaxOutput = maxOutputTokens ?? Math.floor(contextLength * 0.5);

  console.log(`${LOG} Stitch: totalOutputTokens=${totalOutputTokens}, effectiveMaxOutput=${effectiveMaxOutput}`);

  if (totalOutputTokens > effectiveMaxOutput * 0.9) {
    console.log(`${LOG} Stitch: SKIPPING — output too large. Concatenating instead.`);
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
      content: `A large document was processed in ${outputs.length} sections using this instruction: "${instruction}"\n\nThe user will provide all ${outputs.length} section outputs joined by "---CHUNK BOUNDARY---" markers. Your job: smooth the transitions between sections, remove any redundancies at boundaries, and produce a single cohesive output. Do NOT add new content. Do NOT summarize or truncate. Reproduce the COMPLETE text with only the seams refined.`,
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
