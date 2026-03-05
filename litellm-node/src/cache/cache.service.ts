import { Injectable } from '@nestjs/common';
import { DualCacheService } from './dual-cache.service';

/**
 * Minimal ChatCompletionResponse type for cache storage.
 * Intentionally kept loose to avoid coupling to a specific provider's response shape.
 */
export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string | null };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

@Injectable()
export class CacheService {
  constructor(private readonly dualCache: DualCacheService) {}

  /**
   * Retrieve a cached chat completion response.
   */
  async getCachedResponse(key: string): Promise<ChatCompletionResponse | null> {
    return this.dualCache.get<ChatCompletionResponse>(key);
  }

  /**
   * Store a chat completion response in cache.
   */
  async setCachedResponse(
    key: string,
    response: ChatCompletionResponse,
    ttl?: number,
  ): Promise<void> {
    await this.dualCache.set(key, response, ttl);
  }

  /**
   * Increment a rate-limit counter (RPM or TPM) and return the new value.
   */
  async incrementCounter(key: string, ttl: number): Promise<number> {
    return this.dualCache.increment(key, ttl);
  }

  /**
   * Get the current value of a rate-limit counter.
   */
  async getCounter(key: string): Promise<number> {
    return this.dualCache.getCounter(key);
  }

  /**
   * Invalidate (delete) a cache entry.
   */
  async invalidate(key: string): Promise<void> {
    await this.dualCache.del(key);
  }
}
