import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';

export interface Message {
  role: string;
  content: string | null;
  [key: string]: unknown;
}

@Injectable()
export class CacheKeyBuilder {
  /**
   * Build a deterministic cache key for a chat completion response.
   * Hashes model + JSON-stringified messages + sorted params with SHA-256.
   */
  buildResponseCacheKey(
    model: string,
    messages: Message[],
    params: Record<string, unknown>,
  ): string {
    const sortedParams = this.sortObject(params);
    const payload = JSON.stringify({ model, messages, params: sortedParams });
    const hash = createHash('sha256').update(payload).digest('hex');
    return `litellm:response:${hash}`;
  }

  /**
   * Build a cache key for tracking requests-per-minute for a deployment.
   */
  buildRpmCounterKey(deploymentId: string, minute: number): string {
    return `litellm:rpm:${deploymentId}:${minute}`;
  }

  /**
   * Build a cache key for tracking tokens-per-minute for a deployment.
   */
  buildTpmCounterKey(deploymentId: string, minute: number): string {
    return `litellm:tpm:${deploymentId}:${minute}`;
  }

  /**
   * Recursively sort object keys to ensure deterministic serialization.
   */
  private sortObject(obj: Record<string, unknown>): Record<string, unknown> {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      const value = obj[key];
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        sorted[key] = this.sortObject(value as Record<string, unknown>);
      } else {
        sorted[key] = value;
      }
    }
    return sorted;
  }
}
