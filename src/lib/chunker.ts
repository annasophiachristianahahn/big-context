import type { ChunkInput } from "@/types";
import { estimateTokens } from "./token-estimator";

const OVERLAP_TOKENS = 200;

/**
 * Split text into chunks that respect natural boundaries.
 *
 * Uses the text's actual chars-per-token ratio to correctly size chunks
 * for non-Latin scripts (Devanagari, CJK, Arabic, etc.) where the
 * ratio is ~1.5 chars/token instead of ~4 for English.
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
  // Compute the text's actual chars-per-token ratio
  const totalTokens = estimateTokens(text);
  const charsPerToken = text.length / Math.max(totalTokens, 1);

  const maxChunkChars = Math.floor(maxChunkTokens * charsPerToken);
  const overlapChars = Math.floor(OVERLAP_TOKENS * charsPerToken);

  console.log(`[Chunker] text.length=${text.length}, totalTokens=${totalTokens}, charsPerToken=${charsPerToken.toFixed(4)}`);
  console.log(`[Chunker] maxChunkTokens=${maxChunkTokens}, maxChunkChars=${maxChunkChars}, overlapChars=${overlapChars}`);

  if (totalTokens <= maxChunkTokens) {
    console.log(`[Chunker] Text fits in one chunk`);
    return [{ index: 0, text }];
  }

  const chunks: ChunkInput[] = [];
  let offset = 0;

  while (offset < text.length) {
    let end = Math.min(offset + maxChunkChars, text.length);

    if (end < text.length) {
      const searchRegion = text.slice(offset, end);
      const breakPoint = findBestBreakPoint(searchRegion, maxChunkChars);
      if (chunks.length < 5) {
        console.log(`[Chunker] Chunk ${chunks.length}: offset=${offset}, initialEnd=${end}, breakPoint=${breakPoint}, finalEnd=${offset + breakPoint}, chunkSize=${offset + breakPoint - offset}`);
      }
      end = offset + breakPoint;
    }

    const chunkText = text.slice(offset, end).trim();
    if (chunkText.length > 0) {
      chunks.push({
        index: chunks.length,
        text: chunkText,
      });
    }

    // If we've reached the end of the text, we're done — no overlap needed
    if (end >= text.length) break;

    // Move forward with overlap for context continuity between chunks
    offset = Math.max(end - overlapChars, offset + 1);
  }

  console.log(`[Chunker] Result: ${chunks.length} chunks`);
  if (chunks.length > 20) {
    const avgSize = chunks.reduce((s, c) => s + c.text.length, 0) / chunks.length;
    console.log(`[Chunker] WARNING: High chunk count! avgChunkSize=${Math.round(avgSize)} chars`);
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
