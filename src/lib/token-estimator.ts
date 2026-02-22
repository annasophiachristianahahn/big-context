import type { ModelInfo, CostEstimate } from "@/types";

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
 * Calculate estimated cost for a big context processing job.
 *
 * Chunk sizing respects TWO constraints:
 * 1. Context window (40% for input, safety margin)
 * 2. Max output token limit (assumes output ≈ input for translation-like tasks)
 */
export function estimateCost(
  text: string,
  instruction: string,
  model: ModelInfo,
  enableStitchPass: boolean = false
): CostEstimate {
  const totalTextTokens = estimateTokens(text);
  const instructionTokens = estimateTokens(instruction);

  // Reserve for system prompt + instruction + chunk metadata + overlap
  const reservedTokens = 500 + instructionTokens + 200;

  // Constraint 1: Context window — use 40% for chunk text (safety margin)
  const contextBasedLimit =
    Math.floor(model.contextLength * 0.4) - reservedTokens;

  // Constraint 2: Max output tokens — output must fit within model's limit
  // Assume worst case: output ≈ input (translation). 90% safety margin.
  const outputBasedLimit = model.maxOutput
    ? Math.floor(model.maxOutput * 0.9)
    : Infinity;

  const safeChunkSize = Math.max(
    Math.min(contextBasedLimit, outputBasedLimit),
    1000
  );

  const totalChunks = Math.ceil(totalTextTokens / safeChunkSize);

  // Estimate output: min of (chunk size, maxOutput) — can't exceed model's limit
  const rawOutputEstimate = Math.ceil(safeChunkSize / 3);
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
  };
}
