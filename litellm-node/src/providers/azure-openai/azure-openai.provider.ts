import { Injectable } from '@nestjs/common';
import {
  LlmProvider,
  ProviderRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  EmbeddingRequest,
  EmbeddingResponse,
  Deployment,
} from '../../shared/types';
import { ProviderError, ProviderErrorType } from '../../shared/types/errors';
import {
  buildAzureUrl,
  buildAzureHeaders,
  transformRequest,
  transformResponse,
  transformStreamChunk,
} from './azure-openai.transformer';

@Injectable()
export class AzureOpenAIProvider implements LlmProvider {
  readonly providerName = 'azure';

  async chatCompletion(request: ProviderRequest): Promise<ChatCompletionResponse> {
    const { deployment, body, headers } = request;
    const url = buildAzureUrl(deployment, 'chat/completions');
    const transformed = transformRequest(body, deployment);
    transformed['stream'] = false;

    const response = await this.doFetch(url, {
      method: 'POST',
      headers: buildAzureHeaders(deployment, headers),
      body: JSON.stringify(transformed),
    });

    const json = await response.json();

    if (!response.ok) {
      throw this.mapError(response.status, json, deployment);
    }

    return transformResponse(json, body.model);
  }

  async *chatCompletionStream(request: ProviderRequest): AsyncIterable<ChatCompletionChunk> {
    const { deployment, body, headers } = request;
    const url = buildAzureUrl(deployment, 'chat/completions');
    const transformed = transformRequest(body, deployment);
    transformed['stream'] = true;

    const response = await this.doFetch(url, {
      method: 'POST',
      headers: buildAzureHeaders(deployment, headers),
      body: JSON.stringify(transformed),
    });

    if (!response.ok) {
      const json = await response.json().catch(() => ({}));
      throw this.mapError(response.status, json, deployment);
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
              yield transformStreamChunk(parsed, body.model);
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
    const url = buildAzureUrl(deployment, 'embeddings');

    const response = await this.doFetch(url, {
      method: 'POST',
      headers: buildAzureHeaders(deployment),
      body: JSON.stringify(embeddingBody),
    });

    const json = await response.json();

    if (!response.ok) {
      throw this.mapError(response.status, json, deployment);
    }

    return json as EmbeddingResponse;
  }

  /**
   * Wraps global fetch for testability.
   */
  protected doFetch(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, init);
  }

  private mapError(
    status: number,
    body: Record<string, unknown>,
    deployment: Deployment,
  ): ProviderError {
    const errorBody = (body?.error as Record<string, unknown>) ?? {};
    const message =
      (errorBody.message as string) ?? `Azure OpenAI API error (HTTP ${status})`;

    const typeMap: Record<number, ProviderErrorType> = {
      401: ProviderErrorType.AuthenticationError,
      403: ProviderErrorType.AuthenticationError,
      404: ProviderErrorType.NotFoundError,
      429: ProviderErrorType.RateLimitError,
      400: ProviderErrorType.InvalidRequestError,
      422: ProviderErrorType.InvalidRequestError,
      500: ProviderErrorType.ServerError,
      503: ProviderErrorType.ServiceUnavailable,
    };

    const errorType = typeMap[status] ?? ProviderErrorType.Unknown;

    return new ProviderError(
      message,
      status,
      this.providerName,
      errorType,
      body,
    );
  }
}
