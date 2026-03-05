import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  Deployment,
} from '../../shared/types';

/**
 * Known OpenAI-compatible parameters for chat completions.
 * Any parameter not in this set is stripped from the request.
 */
const OPENAI_ALLOWED_PARAMS = new Set([
  'model',
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
  'service_tier',
  'store',
  'metadata',
]);

export interface OpenAIRequest extends Record<string, unknown> {
  model: string;
  messages: ChatCompletionRequest['messages'];
}

export function transformRequest(
  body: ChatCompletionRequest,
  deployment: Deployment,
): OpenAIRequest {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(body)) {
    if (OPENAI_ALLOWED_PARAMS.has(key) && value !== undefined) {
      result[key] = value;
    }
  }

  // Use the deployment model name (could differ from what the client sent)
  result['model'] = deployment.modelName;

  return result as OpenAIRequest;
}

export function transformResponse(response: unknown): ChatCompletionResponse {
  return response as ChatCompletionResponse;
}

export function transformStreamChunk(chunk: unknown): ChatCompletionChunk {
  return chunk as ChatCompletionChunk;
}
