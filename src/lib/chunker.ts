import type { ChunkInput } from "@/types";
import { estimateTokens } from "./token-estimator";

const OVERLAP_TOKENS = 200;
const OVERLAP_CHARS = OVERLAP_TOKENS * 4;

/**
 * Split text into chunks that respect natural boundaries.
 *
 * Split priority:
 * 1. Chapter/section headers (# heading, === divider)
 * 2. Double newlines (paragraph boundaries)
 * 3. Single newlines
 * 4. Sentence boundaries (. ! ? followed by space)
 * 5. Word boundaries (spaces)
 * 6. Hard cut (last resort)
 */
export function splitTextIntoChunks(
  text: string,
  maxChunkTokens: number
): ChunkInput[] {
  const maxChunkChars = maxChunkTokens * 4;

  if (estimateTokens(text) <= maxChunkTokens) {
    return [{ index: 0, text }];
  }

  const chunks: ChunkInput[] = [];
  let offset = 0;

  while (offset < text.length) {
    let end = Math.min(offset + maxChunkChars, text.length);

    if (end < text.length) {
      const searchRegion = text.slice(offset, end);
      const breakPoint = findBestBreakPoint(searchRegion, maxChunkChars);
      end = offset + breakPoint;
    }

    const chunkText = text.slice(offset, end).trim();
    if (chunkText.length > 0) {
      chunks.push({
        index: chunks.length,
        text: chunkText,
      });
    }

    // Move forward with overlap
    offset = Math.max(end - OVERLAP_CHARS, offset + 1);
    if (offset >= text.length) break;
  }

  return chunks;
}

function findBestBreakPoint(text: string, maxChars: number): number {
  const searchStart = Math.floor(maxChars * 0.7);
  const searchRegion = text.slice(searchStart);

  // 1. Section/chapter boundary
  const sectionPattern = /\n(?=#{1,3}\s|\n={3,}|\n-{3,})/g;
  const sectionBreaks = [...searchRegion.matchAll(sectionPattern)];
  if (sectionBreaks.length > 0) {
    const lastMatch = sectionBreaks[sectionBreaks.length - 1];
    return searchStart + (lastMatch.index ?? 0);
  }

  // 2. Double newline (paragraph)
  const lastDoubleNewline = searchRegion.lastIndexOf("\n\n");
  if (lastDoubleNewline !== -1) {
    return searchStart + lastDoubleNewline + 2;
  }

  // 3. Single newline
  const lastNewline = searchRegion.lastIndexOf("\n");
  if (lastNewline !== -1) {
    return searchStart + lastNewline + 1;
  }

  // 4. Sentence boundary
  const sentencePattern = /[.!?]\s+/g;
  const sentenceBreaks = [...searchRegion.matchAll(sentencePattern)];
  if (sentenceBreaks.length > 0) {
    const lastMatch = sentenceBreaks[sentenceBreaks.length - 1];
    return searchStart + (lastMatch.index ?? 0) + lastMatch[0].length;
  }

  // 5. Word boundary
  const lastSpace = searchRegion.lastIndexOf(" ");
  if (lastSpace !== -1) {
    return searchStart + lastSpace + 1;
  }

  // 6. Hard cut
  return maxChars;
}

/**
 * Calculate max tokens per chunk given model context, instruction size,
 * and the model's max output token limit.
 *
 * Two constraints determine chunk size:
 * 1. Context window: input + output must fit. We use 40% for input (safety margin).
 * 2. Max output tokens: the model can only generate this many tokens per call.
 *    For tasks like translation (output ≈ input), chunks must be ≤ maxOutput.
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
