import type { ModelInfo, CostEstimate } from "@/types";

/**
 * Rough token estimation: ~4 characters per token for English text.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Calculate estimated cost for a big context processing job.
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

  // Available tokens per chunk for actual text content
  const availablePerChunk =
    Math.floor(model.contextLength * 0.5) - reservedTokens;
  const safeChunkSize = Math.max(availablePerChunk, 1000);

  const totalChunks = Math.ceil(totalTextTokens / safeChunkSize);

  // Estimate output at ~1/3 of input per chunk
  const estimatedOutputPerChunk = Math.ceil(safeChunkSize / 3);
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
