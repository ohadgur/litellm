export interface Deployment {
  modelName: string;
  apiKey: string;
  apiBase?: string;
  organizationId?: string;
  provider: string;
  modelId?: string;
}

export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'function';
  content: string | null;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  function_call?: FunctionCall;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: FunctionCall;
}

export interface FunctionCall {
  name: string;
  arguments: string;
}

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatCompletionMessage[];
  temperature?: number;
  top_p?: number;
  n?: number;
  stream?: boolean;
  stop?: string | string[];
  max_tokens?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  logit_bias?: Record<string, number>;
  user?: string;
  tools?: Tool[];
  tool_choice?: string | { type: string; function: { name: string } };
  response_format?: { type: string };
  seed?: number;
  [key: string]: unknown;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatCompletionMessage;
  finish_reason: string | null;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: Usage;
  system_fingerprint?: string;
}

export interface ChatCompletionChunkDelta {
  role?: string;
  content?: string | null;
  tool_calls?: Partial<ToolCall>[];
  function_call?: Partial<FunctionCall>;
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: ChatCompletionChunkDelta;
  finish_reason: string | null;
}

export interface ChatCompletionChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
  system_fingerprint?: string;
  usage?: Usage | null;
}

export interface EmbeddingRequest {
  model: string;
  input: string | string[];
  encoding_format?: 'float' | 'base64';
  dimensions?: number;
  user?: string;
}

export interface EmbeddingData {
  object: 'embedding';
  embedding: number[];
  index: number;
}

export interface EmbeddingResponse {
  object: 'list';
  data: EmbeddingData[];
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export interface ModelInfo {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

export interface ProviderRequest {
  deployment: Deployment;
  body: ChatCompletionRequest;
  headers?: Record<string, string>;
}

export interface LlmProvider {
  readonly providerName: string;
  chatCompletion(request: ProviderRequest): Promise<ChatCompletionResponse>;
  chatCompletionStream(request: ProviderRequest): AsyncIterable<ChatCompletionChunk>;
  embedding?(request: EmbeddingRequest & { deployment: Deployment }): Promise<EmbeddingResponse>;
  listModels?(deployment: Deployment): Promise<ModelInfo[]>;
}
