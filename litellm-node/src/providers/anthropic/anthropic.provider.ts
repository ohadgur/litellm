/**
 * Anthropic LLM provider -- sends requests to the Anthropic Messages API
 * and translates between the OpenAI chat-completion wire format and
 * the Anthropic wire format.
 */

import { Injectable } from '@nestjs/common';
import {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  Deployment,
  LlmProvider,
} from '../types/llm-provider.interface';
import {
  AnthropicResponse,
  AnthropicStreamEvent,
  StreamTransformer,
  stripModelPrefix,
  transformRequest,
  transformResponse,
} from './anthropic.transformer';

const ANTHROPIC_API_BASE = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';

@Injectable()
export class AnthropicProvider implements LlmProvider {
  // ------------------------------------------------------------------
  // Non-streaming
  // ------------------------------------------------------------------

  async chatCompletion(
    request: ChatCompletionRequest,
    deployment: Deployment,
  ): Promise<ChatCompletionResponse> {
    const modelName = stripModelPrefix(deployment.litellmParams.model);
    const body = transformRequest(request, modelName);
    // Never stream for the non-streaming path
    delete body.stream;

    const apiBase = deployment.litellmParams.api_base ?? ANTHROPIC_API_BASE;
    const url = `${apiBase}/v1/messages`;

    const res = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(deployment.litellmParams.api_key),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${text}`);
    }

    const anthropicResponse: AnthropicResponse = await res.json();
    return transformResponse(anthropicResponse, modelName);
  }

  // ------------------------------------------------------------------
  // Streaming
  // ------------------------------------------------------------------

  async *chatCompletionStream(
    request: ChatCompletionRequest,
    deployment: Deployment,
  ): AsyncIterable<ChatCompletionChunk> {
    const modelName = stripModelPrefix(deployment.litellmParams.model);
    const body = transformRequest(request, modelName);
    body.stream = true;

    const apiBase = deployment.litellmParams.api_base ?? ANTHROPIC_API_BASE;
    const url = `${apiBase}/v1/messages`;

    const res = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(deployment.litellmParams.api_key),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${text}`);
    }

    if (!res.body) {
      throw new Error('Response body is null');
    }

    const transformer = new StreamTransformer();
    yield* this.parseSSEStream(res.body, transformer);
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private buildHeaders(apiKey: string): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    };
  }

  private async *parseSSEStream(
    body: ReadableStream<Uint8Array>,
    transformer: StreamTransformer,
  ): AsyncIterable<ChatCompletionChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last (possibly incomplete) line in the buffer
        buffer = lines.pop() ?? '';

        let currentEventData: string | null = null;

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            currentEventData = line.slice(6);
          } else if (line === '' && currentEventData !== null) {
            // Empty line marks end of an event
            if (currentEventData === '[DONE]') {
              return;
            }
            try {
              const event: AnthropicStreamEvent = JSON.parse(currentEventData);
              const chunk = transformer.transform(event);
              if (chunk) {
                yield chunk;
              }
            } catch {
              // Skip malformed JSON lines
            }
            currentEventData = null;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
