/**
 * Core routing types for the LiteLLM Router module.
 */

export interface Deployment {
  id: string;
  modelName: string;
  litellmParams: {
    model: string;
    apiKey?: string;
    apiBase?: string;
    weight?: number;
    rpm?: number;
    tpm?: number;
    [key: string]: unknown;
  };
  modelInfo?: {
    id: string;
    [key: string]: unknown;
  };
}

export interface RoutingContext {
  estimatedTokens?: number;
  inFlightCounts?: Map<string, number>;
  latencyMap?: Map<string, number>;
  rpmUsage?: Map<string, number>;
  tpmUsage?: Map<string, number>;
}

export enum RoutingStrategy {
  SIMPLE_SHUFFLE = 'simple-shuffle',
  LEAST_BUSY = 'least-busy',
  LOWEST_LATENCY = 'lowest-latency',
  LOWEST_TPM_RPM = 'lowest-tpm-rpm',
}

export interface DeploymentHealth {
  deploymentId: string;
  isHealthy: boolean;
  cooldownUntil?: number;
  failureCount: number;
  lastFailure?: number;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface FallbackConfig {
  modelName: string;
  fallbacks: string[];
  contextWindowFallbacks?: string[];
}

export interface ChatCompletionRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
  [key: string]: unknown;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ChatCompletionChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: string; content?: string };
    finish_reason: string | null;
  }>;
}

export interface ModelConfig {
  modelName: string;
  deployments: Deployment[];
  strategy?: RoutingStrategy;
  fallbacks?: string[];
  contextWindowFallbacks?: string[];
}

export interface ProviderError extends Error {
  status?: number;
  code?: string;
}
