export interface Deployment {
  modelName: string;
  litellmParams: LiteLLMParams;
  modelInfo?: ModelInfo;
}

export interface LiteLLMParams {
  model: string;
  apiKey?: string;
  apiBase?: string;
  apiVersion?: string;
  awsRegionName?: string;
  vertexProject?: string;
  vertexLocation?: string;
  timeout?: number;
  rpm?: number;
  tpm?: number;
  maxBudget?: number;
}

export interface ModelInfo {
  id: string;
  dbModel?: boolean;
  maxTokens?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  inputCostPerToken?: number;
  outputCostPerToken?: number;
  mode?: string;
}
