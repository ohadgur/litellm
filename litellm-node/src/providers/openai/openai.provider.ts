import { Injectable } from '@nestjs/common';
import {
  LlmProvider,
  ProviderRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  EmbeddingRequest,
  EmbeddingResponse,
  ModelInfo,
  Deployment,
} from '../../shared/types';
import { ProviderError, ProviderErrorType } from '../../shared/types/errors';
import {
  transformRequest,
  transformResponse,
  transformStreamChunk,
} from './openai.transformer';

const DEFAULT_API_BASE = 'https://api.openai.com/v1';

const STATUS_TO_ERROR_TYPE: Readonly<Record<number, ProviderErrorType>> = {
  401: ProviderErrorType.AuthenticationError,
  403: ProviderErrorType.AuthenticationError,
  404: ProviderErrorType.NotFoundError,
  429: ProviderErrorType.RateLimitError,
  400: ProviderErrorType.InvalidRequestError,
  422: ProviderErrorType.InvalidRequestError,
  500: ProviderErrorType.ServerError,
  503: ProviderErrorType.ServiceUnavailable,
};

@Injectable()
export class OpenAIProvider implements LlmProvider {
  readonly providerName = 'openai';

  async chatCompletion(request: ProviderRequest): Promise<ChatCompletionResponse> {
    const { deployment, body, headers } = request;
    const apiBase = deployment.apiBase ?? DEFAULT_API_BASE;
    const url = `${apiBase}/chat/completions`;
    const transformed = transformRequest(body, deployment);

    // Ensure stream is false for non-streaming calls
    transformed['stream'] = false;

    const response = await this.doFetch(url, {
      method: 'POST',
      headers: this.buildHeaders(deployment, headers),
      body: JSON.stringify(transformed),
    });

    const json = await response.json();

    if (!response.ok) {
      throw this.mapError(response.status, json);
    }

    return transformResponse(json);
  }

  async *chatCompletionStream(request: ProviderRequest): AsyncIterable<ChatCompletionChunk> {
    const { deployment, body, headers } = request;
    const apiBase = deployment.apiBase ?? DEFAULT_API_BASE;
    const url = `${apiBase}/chat/completions`;
    const transformed = transformRequest(body, deployment);
    transformed['stream'] = true;

    const response = await this.doFetch(url, {
      method: 'POST',
      headers: this.buildHeaders(deployment, headers),
      body: JSON.stringify(transformed),
    });

    if (!response.ok) {
      const json = await response.json().catch(() => ({}));
      throw this.mapError(response.status, json);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new ProviderError(
        'No response body for streaming request',
        500,
        this.providerName,
        ProviderErrorType.ServerError,
      );
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last (potentially incomplete) line in the buffer
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          if (trimmed === 'data: [DONE]') {
            return;
          }

          if (trimmed.startsWith('data: ')) {
            const jsonStr = trimmed.slice(6);
            try {
              const parsed = JSON.parse(jsonStr);
              yield transformStreamChunk(parsed);
            } catch {
              // Skip malformed JSON chunks
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async embedding(
    request: EmbeddingRequest & { deployment: Deployment },
  ): Promise<EmbeddingResponse> {
    const { deployment, ...embeddingBody } = request;
    const apiBase = deployment.apiBase ?? DEFAULT_API_BASE;
    const url = `${apiBase}/embeddings`;

    const response = await this.doFetch(url, {
      method: 'POST',
      headers: this.buildHeaders(deployment),
      body: JSON.stringify({
        ...embeddingBody,
        model: deployment.modelName,
      }),
    });

    const json = await response.json();

    if (!response.ok) {
      throw this.mapError(response.status, json);
    }

    return json as EmbeddingResponse;
  }

  async listModels(deployment: Deployment): Promise<ModelInfo[]> {
    const apiBase = deployment.apiBase ?? DEFAULT_API_BASE;
    const url = `${apiBase}/models`;

    const response = await this.doFetch(url, {
      method: 'GET',
      headers: this.buildHeaders(deployment),
    });

    const json = await response.json();

    if (!response.ok) {
      throw this.mapError(response.status, json);
    }

    return (json as { data: ModelInfo[] }).data;
  }

  private buildHeaders(
    deployment: Deployment,
    extra?: Record<string, string>,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${deployment.apiKey}`,
      ...extra,
    };

    if (deployment.organizationId) {
      headers['OpenAI-Organization'] = deployment.organizationId;
    }

    return headers;
  }

  /**
   * Wraps global fetch for testability. Tests can spy on this method
   * to mock HTTP responses without patching the global.
   */
  protected doFetch(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, init);
  }

  private mapError(
    status: number,
    body: Record<string, unknown>,
  ): ProviderError {
    const errorBody = (body?.error as Record<string, unknown>) ?? {};
    const message =
      (errorBody.message as string) ?? `OpenAI API error (HTTP ${status})`;

    const errorType = STATUS_TO_ERROR_TYPE[status] ?? ProviderErrorType.Unknown;

    return new ProviderError(
      message,
      status,
      this.providerName,
      errorType,
      body,
    );
  }
}
