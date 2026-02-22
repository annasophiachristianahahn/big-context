// === OpenRouter Model Catalog ===
export interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number;
  pricing: {
    prompt: string; // price per token as string
    completion: string;
  };
  top_provider?: {
    max_completion_tokens?: number;
  };
  architecture?: {
    modality: string;
    tokenizer: string;
  };
}

export interface ModelInfo {
  id: string;
  name: string;
  contextLength: number;
  maxOutput: number;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  isFree: boolean;
}

// === OpenRouter API types ===
export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenRouterUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
    cache_write_tokens?: number;
  };
  cost_details?: {
    input_cost?: number;
    cache_creation_input_cost?: number;
    cache_read_input_cost?: number;
    output_cost?: number;
  };
}

export interface OpenRouterResponse {
  id: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: OpenRouterUsage;
}

export interface OpenRouterStreamChunk {
  id: string;
  choices: Array<{
    index: number;
    delta: {
      content?: string;
      role?: string;
    };
    finish_reason: string | null;
  }>;
  usage?: OpenRouterUsage;
}

// === Chunk processing types ===
export interface ChunkInput {
  index: number;
  text: string;
}

export interface ChunkResult {
  index: number;
  output: string;
  tokens: number;
  cost: number;
  status: "completed" | "failed";
  error?: string;
}

export interface CostEstimate {
  totalChunks: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCost: number;
  model: string;
  modelName: string;
}

// === Chat types ===
export interface ChatStats {
  totalApiCalls: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCost: number;
  totalCacheSavings: number;
}

export interface ChunkJobStatus {
  id: string;
  status: string;
  totalChunks: number;
  completedChunks: number;
  chunks: Array<{
    index: number;
    status: string;
    error?: string | null;
  }>;
  stitchedOutput?: string;
}
