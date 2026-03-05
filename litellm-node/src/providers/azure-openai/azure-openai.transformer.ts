import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  Deployment,
} from '../../shared/types';

const DEFAULT_API_VERSION = '2024-06-01';

/**
 * Azure-compatible request body. Identical to OpenAI except the `model` field
 * is omitted because Azure encodes deployment in the URL path.
 */
export interface AzureOpenAIRequest extends Record<string, unknown> {
  messages: ChatCompletionRequest['messages'];
}

/**
 * Known OpenAI-compatible parameters allowed in the request body.
 * `model` is intentionally excluded -- Azure puts it in the URL.
 */
const AZURE_ALLOWED_BODY_PARAMS = new Set([
  'messages',
  'temperature',
  'top_p',
  'n',
  'stream',
  'stream_options',
  'stop',
  'max_tokens',
  'max_completion_tokens',
  'presence_penalty',
  'frequency_penalty',
  'logit_bias',
  'logprobs',
  'top_logprobs',
  'user',
  'tools',
  'tool_choice',
  'parallel_tool_calls',
  'response_format',
  'seed',
]);

/**
 * Strip the `azure/` prefix from a model name to derive the deployment name.
 */
export function extractDeploymentName(model: string): string {
  return model.startsWith('azure/') ? model.slice('azure/'.length) : model;
}

/**
 * Build the full Azure OpenAI endpoint URL for a given path suffix.
 *
 * Result: `{apiBase}/openai/deployments/{deployment}/{suffix}?api-version={version}`
 */
export function buildAzureUrl(
  deployment: Deployment,
  suffix: string,
  apiVersion?: string,
): string {
  const base = (deployment.apiBase ?? '').replace(/\/+$/, '');
  const deploymentName = extractDeploymentName(deployment.modelName);
  const version = apiVersion ?? DEFAULT_API_VERSION;
  return `${base}/openai/deployments/${deploymentName}/${suffix}?api-version=${version}`;
}

/**
 * Build Azure-specific headers. Azure uses `api-key` instead of
 * `Authorization: Bearer`.
 */
export function buildAzureHeaders(
  deployment: Deployment,
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'api-key': deployment.apiKey,
    ...extra,
  };
}

/**
 * Transform a ChatCompletionRequest into an Azure-compatible request body.
 * The `model` field is removed because Azure routes via URL path.
 */
export function transformRequest(
  body: ChatCompletionRequest,
  _deployment: Deployment,
): AzureOpenAIRequest {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(body)) {
    if (AZURE_ALLOWED_BODY_PARAMS.has(key) && value !== undefined) {
      result[key] = value;
    }
  }

  return result as AzureOpenAIRequest;
}

/**
 * Transform the Azure response. Azure returns an OpenAI-compatible format,
 * but we ensure the model field matches the user's alias.
 */
export function transformResponse(
  response: unknown,
  userModel?: string,
): ChatCompletionResponse {
  const res = response as ChatCompletionResponse;
  if (userModel) {
    res.model = userModel;
  }
  return res;
}

/**
 * Transform an Azure streaming chunk. Passthrough with optional model override.
 */
export function transformStreamChunk(
  chunk: unknown,
  userModel?: string,
): ChatCompletionChunk {
  const res = chunk as ChatCompletionChunk;
  if (userModel) {
    res.model = userModel;
  }
  return res;
}
