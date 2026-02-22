import type { ChunkInput } from "@/types";
import { estimateTokens, calculateMaxChunkTokens } from "./token-estimator";

// Re-export for consumers that imported from chunker
export { calculateMaxChunkTokens } from "./token-estimator";

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

  if (totalTokens <= maxChunkTokens) {
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

    // If we've reached the end of the text, we're done — no overlap needed
    if (end >= text.length) break;

    // Move forward with overlap for context continuity between chunks
    offset = Math.max(end - overlapChars, offset + 1);
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
