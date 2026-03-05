import {
  ChatCompletionChunk,
  ChatCompletionChunkUsage,
} from './types';

/**
 * Accumulates usage statistics across streaming chunks.
 * Call `accumulate` for every chunk and `getTotal` for the final summary.
 */
export class UsageAccumulator {
  private promptTokens = 0;
  private completionTokens = 0;
  private totalTokens = 0;
  private hasUsage = false;

  accumulate(usage: ChatCompletionChunkUsage | null | undefined): void {
    if (!usage) return;
    this.hasUsage = true;
    this.promptTokens = Math.max(this.promptTokens, usage.prompt_tokens ?? 0);
    this.completionTokens = Math.max(this.completionTokens, usage.completion_tokens ?? 0);
    this.totalTokens = Math.max(this.totalTokens, usage.total_tokens ?? 0);
  }

  getTotal(): ChatCompletionChunkUsage | null {
    if (!this.hasUsage) return null;
    return {
      prompt_tokens: this.promptTokens,
      completion_tokens: this.completionTokens,
      total_tokens: this.totalTokens,
    };
  }
}

/**
 * Normalizes a raw provider streaming chunk into the OpenAI
 * ChatCompletionChunk format.
 *
 * Currently supports OpenAI-format passthrough. Additional provider
 * normalizations can be added via the `provider` parameter.
 */
export function normalizeStreamChunk(
  providerChunk: Record<string, unknown>,
  _provider: string,
): ChatCompletionChunk {
  // Ensure required top-level fields
  const id = (providerChunk.id as string) ?? `chatcmpl-${Date.now()}`;
  const object = 'chat.completion.chunk' as const;
  const created = (providerChunk.created as number) ?? Math.floor(Date.now() / 1000);
  const model = (providerChunk.model as string) ?? 'unknown';

  // Normalize choices
  const rawChoices = Array.isArray(providerChunk.choices) ? providerChunk.choices : [];
  const choices = rawChoices.map((c: Record<string, unknown>) => ({
    index: (c.index as number) ?? 0,
    delta: (c.delta as Record<string, unknown>) ?? {},
    finish_reason: (c.finish_reason as string | null) ?? null,
  }));

  // Normalize usage (may be absent on most chunks)
  const rawUsage = providerChunk.usage as Record<string, unknown> | undefined;
  const usage = rawUsage
    ? {
        prompt_tokens: (rawUsage.prompt_tokens as number) ?? 0,
        completion_tokens: (rawUsage.completion_tokens as number) ?? 0,
        total_tokens: (rawUsage.total_tokens as number) ?? 0,
      }
    : null;

  return { id, object, created, model, choices, usage };
}
