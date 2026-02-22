import type { OpenRouterMessage } from "@/types";
import { estimateTokens } from "./token-estimator";

interface DbMessage {
  role: string;
  content: string;
  summary: string | null;
}

/**
 * Build message context for an API call, ensuring it fits within the model's context window.
 * Strategy:
 * 1. Always include the system prompt (if any) and recent messages.
 * 2. If total exceeds the budget, replace older large messages with their summaries.
 * 3. If still too large, truncate oldest messages.
 */
export function buildMessageContext(
  messages: DbMessage[],
  systemPrompt: string | null,
  contextLength: number
): OpenRouterMessage[] {
  // Reserve 50% for output, use 50% for input
  const tokenBudget = Math.floor(contextLength * 0.5);

  const result: OpenRouterMessage[] = [];

  // Add system prompt if present
  if (systemPrompt) {
    result.push({ role: "system", content: systemPrompt });
  }

  // Start with all messages
  const processedMessages: OpenRouterMessage[] = messages.map((m) => ({
    role: m.role as "user" | "assistant" | "system",
    content: m.content,
  }));

  // Check if everything fits
  let totalTokens = estimateTokensForMessages([...result, ...processedMessages]);

  if (totalTokens <= tokenBudget) {
    return [...result, ...processedMessages];
  }

  // Strategy: replace large older messages with summaries (keep last 4 messages intact)
  const keepRecentCount = Math.min(4, messages.length);
  const olderMessages = messages.slice(0, messages.length - keepRecentCount);
  const recentMessages = messages.slice(messages.length - keepRecentCount);

  const compressedOlder: OpenRouterMessage[] = olderMessages.map((m) => {
    // Use summary if available and the content is large
    if (m.summary && estimateTokens(m.content) > 500) {
      return {
        role: m.role as "user" | "assistant" | "system",
        content: m.summary,
      };
    }
    return {
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    };
  });

  const recentProcessed: OpenRouterMessage[] = recentMessages.map((m) => ({
    role: m.role as "user" | "assistant" | "system",
    content: m.content,
  }));

  totalTokens = estimateTokensForMessages([
    ...result,
    ...compressedOlder,
    ...recentProcessed,
  ]);

  if (totalTokens <= tokenBudget) {
    return [...result, ...compressedOlder, ...recentProcessed];
  }

  // Still too large: progressively drop oldest compressed messages
  let trimmedOlder = [...compressedOlder];
  while (trimmedOlder.length > 0) {
    trimmedOlder = trimmedOlder.slice(1);
    totalTokens = estimateTokensForMessages([
      ...result,
      ...trimmedOlder,
      ...recentProcessed,
    ]);
    if (totalTokens <= tokenBudget) {
      break;
    }
  }

  // Add context note if we dropped messages
  if (trimmedOlder.length < compressedOlder.length) {
    const droppedCount = compressedOlder.length - trimmedOlder.length;
    result.push({
      role: "system",
      content: `[Note: ${droppedCount} earlier messages were omitted to fit context window. The conversation continues from the most recent messages.]`,
    });
  }

  return [...result, ...trimmedOlder, ...recentProcessed];
}

function estimateTokensForMessages(messages: OpenRouterMessage[]): number {
  return messages.reduce(
    (sum, m) => sum + estimateTokens(m.content) + 4, // +4 for message overhead
    0
  );
}
