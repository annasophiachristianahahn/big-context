import type {
  OpenRouterMessage,
  OpenRouterResponse,
  OpenRouterStreamChunk,
  OpenRouterModel,
  ModelInfo,
} from "@/types";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

function getApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  return key;
}

function getHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getApiKey()}`,
    "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    "X-Title": "Big Context",
  };
}

// === Model Catalog ===

let cachedModels: ModelInfo[] | null = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

export async function fetchModels(): Promise<ModelInfo[]> {
  const now = Date.now();
  if (cachedModels && now - cacheTimestamp < CACHE_DURATION) {
    return cachedModels;
  }

  const response = await fetch(`${OPENROUTER_BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${getApiKey()}` },
    next: { revalidate: 3600 }, // Next.js server-side cache for 1 hour
  } as RequestInit);

  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.status}`);
  }

  const data = await response.json();
  const rawModels: OpenRouterModel[] = data.data ?? [];

  // Filter to text-based models and transform
  const models: ModelInfo[] = rawModels
    .filter(
      (m) =>
        m.context_length > 0 &&
        m.pricing &&
        (!m.architecture || m.architecture.modality?.includes("text"))
    )
    .map((m) => ({
      id: m.id,
      name: m.name,
      contextLength: m.context_length,
      maxOutput: m.top_provider?.max_completion_tokens ?? 4096,
      inputPricePerMillion: parseFloat(m.pricing.prompt) * 1_000_000,
      outputPricePerMillion: parseFloat(m.pricing.completion) * 1_000_000,
      isFree:
        parseFloat(m.pricing.prompt) === 0 &&
        parseFloat(m.pricing.completion) === 0,
      createdAt: m.created ?? 0,
    }))
    .sort((a, b) => {
      // Featured models first
      const featured = [
        "anthropic/claude-sonnet-4.6",
        "anthropic/claude-opus-4.6",
      ];
      const aFeatured = featured.indexOf(a.id);
      const bFeatured = featured.indexOf(b.id);
      if (aFeatured >= 0 && bFeatured < 0) return -1;
      if (bFeatured >= 0 && aFeatured < 0) return 1;
      if (aFeatured >= 0 && bFeatured >= 0) return aFeatured - bFeatured;
      // Then free models
      if (a.isFree && !b.isFree) return -1;
      if (b.isFree && !a.isFree) return 1;
      // Then by name
      return a.name.localeCompare(b.name);
    });

  cachedModels = models;
  cacheTimestamp = now;
  return models;
}

export function getModelById(
  models: ModelInfo[],
  modelId: string
): ModelInfo | undefined {
  return models.find((m) => m.id === modelId);
}

// === Chat Completions ===

export async function chatCompletion(
  model: string,
  messages: OpenRouterMessage[],
  maxTokens?: number
): Promise<OpenRouterResponse> {
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false,
  };
  if (maxTokens) body.max_tokens = maxTokens;

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${errorBody}`);
  }

  return response.json();
}

export async function chatCompletionStream(
  model: string,
  messages: OpenRouterMessage[],
  maxTokens?: number
): Promise<Response> {
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
  };
  if (maxTokens) body.max_tokens = maxTokens;

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${errorBody}`);
  }

  return response;
}

/**
 * Generate a short title for a chat based on the first user content.
 * Uses a lightweight prompt to produce 3-7 words.
 */
export async function generateChatTitle(
  model: string,
  firstUserContent: string
): Promise<string> {
  const truncated = firstUserContent.slice(0, 1500);
  const titleMessages: OpenRouterMessage[] = [
    {
      role: "system",
      content:
        "Generate a concise title (3-7 words) for this conversation. Return ONLY the title text. No quotes, no punctuation at the end, no explanation. Examples: 'Bhagavad Gita Translation', 'React Auth Implementation', 'Budget Analysis Q4'",
    },
    {
      role: "user",
      content: truncated,
    },
  ];

  const response = await chatCompletion(model, titleMessages, 30);
  const title = response.choices[0]?.message?.content?.trim();

  if (title && title.length > 0 && title.length < 100) {
    // Clean up common LLM artifacts
    return title
      .replace(/^["']|["']$/g, "") // Remove wrapping quotes
      .replace(/\.$/g, "") // Remove trailing period
      .trim();
  }

  return firstUserContent.slice(0, 50).split("\n")[0] || "New Chat";
}

export async function* parseSSEStream(
  response: Response
): AsyncGenerator<OpenRouterStreamChunk> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith(":")) continue;
        if (trimmed === "data: [DONE]") return;

        if (trimmed.startsWith("data: ")) {
          try {
            const json = JSON.parse(trimmed.slice(6));
            yield json as OpenRouterStreamChunk;
          } catch {
            // Skip malformed JSON
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
