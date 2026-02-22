import type { ModelInfo, CostEstimate } from "@/types";

const OVERLAP_TOKENS = 200;

/**
 * Token estimation that accounts for different scripts.
 *
 * ASCII/Latin text: ~4 characters per token (English, etc.)
 * Non-ASCII text (Devanagari, CJK, Arabic, etc.): ~1.5 characters per token
 * because most tokenizers represent non-Latin characters as multiple tokens.
 *
 * This is critical for documents in Hindi/Sanskrit/etc. where the naive
 * 4-chars-per-token estimate would undercount by 2-3x, causing chunks
 * that are far too large for the model's output limit.
 */
export function estimateTokens(text: string): number {
  let nonAsciiCount = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) nonAsciiCount++;
  }
  const asciiCount = text.length - nonAsciiCount;
  // ASCII: ~4 chars/token, Non-ASCII: ~1.5 chars/token
  return Math.ceil(asciiCount / 4 + nonAsciiCount / 1.5);
}

/**
 * Calculate max tokens per chunk given model context, instruction size,
 * and the model's max output token limit.
 *
 * Two constraints determine chunk size:
 * 1. Context window: input + output must fit. We use 40% for input (safety margin).
 * 2. Max output tokens: the model can only generate this many tokens per call.
 *    For tasks like translation (output ≈ input), chunks must be ≤ maxOutput.
 *
 * This function is the SINGLE SOURCE OF TRUTH for chunk sizing — used by both
 * the actual chunker and the cost estimator.
 */
export function calculateMaxChunkTokens(
  contextLength: number,
  instructionTokens: number,
  maxOutputTokens?: number
): number {
  const systemPromptReserve = 500;
  const chunkMetadataReserve = 100;
  const overlapReserve = OVERLAP_TOKENS;

  // Constraint 1: Use 40% of context for chunk text (leaves 60% for output + reserves)
  const contextBasedLimit =
    contextLength * 0.4 -
    systemPromptReserve -
    instructionTokens -
    chunkMetadataReserve -
    overlapReserve;

  // Constraint 2: Output must fit in maxOutput. Assume worst case: output ≈ input (translation).
  // Apply 90% safety margin on maxOutput to avoid truncation.
  const outputBasedLimit = maxOutputTokens
    ? Math.floor(maxOutputTokens * 0.9)
    : Infinity;

  // Use the more restrictive constraint
  const limit = Math.min(contextBasedLimit, outputBasedLimit);

  return Math.max(Math.floor(limit), 2000);
}

/**
 * Calculate estimated cost for a big context processing job.
 *
 * Uses the SAME calculateMaxChunkTokens function as the actual chunker,
 * ensuring the cost estimate chunk count matches what actually happens.
 */
export function estimateCost(
  text: string,
  instruction: string,
  model: ModelInfo,
  enableStitchPass: boolean = false
): CostEstimate {
  const totalTextTokens = estimateTokens(text);
  const instructionTokens = estimateTokens(instruction);

  // Use the exact same function the chunker uses — ensures estimate matches actual chunking
  const safeChunkSize = calculateMaxChunkTokens(
    model.contextLength,
    instructionTokens,
    model.maxOutput
  );

  const totalChunks = Math.ceil(totalTextTokens / safeChunkSize);

  // Reserve tokens per chunk (system prompt + instruction + metadata + overlap)
  const reservedTokens = 500 + instructionTokens + 100 + OVERLAP_TOKENS;

  // Estimate output: for translation-like tasks, output ≈ input.
  // Use 80% of chunk size as estimate (conservative).
  const rawOutputEstimate = Math.ceil(safeChunkSize * 0.8);
  const estimatedOutputPerChunk = model.maxOutput
    ? Math.min(rawOutputEstimate, model.maxOutput)
    : rawOutputEstimate;

  let estimatedInputTokens = totalChunks * (safeChunkSize + reservedTokens);
  let estimatedOutputTokens = totalChunks * estimatedOutputPerChunk;

  if (enableStitchPass && totalChunks > 1) {
    estimatedInputTokens += estimatedOutputTokens + 500;
    estimatedOutputTokens += Math.ceil(estimatedOutputTokens * 0.9);
  }

  const inputCost =
    (estimatedInputTokens / 1_000_000) * model.inputPricePerMillion;
  const outputCost =
    (estimatedOutputTokens / 1_000_000) * model.outputPricePerMillion;
  const estimatedCostTotal = inputCost + outputCost;

  return {
    totalChunks,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCost: Math.round(estimatedCostTotal * 10000) / 10000,
    model: model.id,
    modelName: model.name,
    maxOutputPerCall: model.maxOutput,
    tokensPerChunk: safeChunkSize,
    totalTextTokens,
  };
}
