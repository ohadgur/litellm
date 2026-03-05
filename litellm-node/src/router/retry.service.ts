import { Injectable } from '@nestjs/common';

import { ProviderError, RetryConfig } from './types/routing';

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 2,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
};

/** HTTP status codes that should NOT be retried. */
const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 404]);

/** HTTP status codes that should always be retried. */
const RETRYABLE_STATUSES = new Set([429, 408, 500, 502, 503, 504]);

@Injectable()
export class RetryService {
  private readonly config: RetryConfig;

  constructor(config?: Partial<RetryConfig>) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
  }

  /**
   * Execute an operation with retry logic.
   *
   * Retries on rate limit (429) and timeout (408) errors with exponential backoff.
   * Does NOT retry on auth errors (401/403) or content policy (400).
   */
  async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        if (!this.isRetryable(error as Error)) {
          throw error;
        }

        if (attempt < this.config.maxRetries) {
          const delayMs = this.calculateDelay(attempt);
          await this.sleep(delayMs);
        }
      }
    }

    throw lastError!;
  }

  isRetryable(error: Error): boolean {
    const providerError = error as ProviderError;
    const status = providerError.status;

    if (status != null) {
      if (NON_RETRYABLE_STATUSES.has(status)) {
        return false;
      }
      if (RETRYABLE_STATUSES.has(status)) {
        return true;
      }
    }

    // Retry on timeout-related error messages
    const message = error.message?.toLowerCase() ?? '';
    if (message.includes('timeout') || message.includes('econnreset')) {
      return true;
    }

    return false;
  }

  private calculateDelay(attempt: number): number {
    const exponentialDelay = this.config.baseDelayMs * Math.pow(2, attempt);
    const jitter = Math.random() * this.config.baseDelayMs;
    return Math.min(exponentialDelay + jitter, this.config.maxDelayMs);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
