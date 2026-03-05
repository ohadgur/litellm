import { Injectable, Logger } from '@nestjs/common';

import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  FallbackConfig,
  ProviderError,
} from './types/routing';

/**
 * Provider function type that the FallbackService delegates to.
 * This is injected by the RouterService to avoid circular dependencies.
 */
export type ProviderCallFn = (
  modelName: string,
  request: ChatCompletionRequest,
) => Promise<ChatCompletionResponse>;

@Injectable()
export class FallbackService {
  private readonly logger = new Logger(FallbackService.name);
  private readonly fallbackConfigs = new Map<string, FallbackConfig>();

  registerFallbacks(configs: FallbackConfig[]): void {
    for (const config of configs) {
      this.fallbackConfigs.set(config.modelName, config);
    }
  }

  getFallbackConfig(modelName: string): FallbackConfig | undefined {
    return this.fallbackConfigs.get(modelName);
  }

  /**
   * Execute fallback chain for a failed model.
   *
   * Tries each fallback model in order. Returns the first successful response.
   * If all fallbacks fail, throws the last error.
   */
  async executeFallback(
    modelName: string,
    request: ChatCompletionRequest,
    originalError: Error,
    providerCallFn: ProviderCallFn,
  ): Promise<ChatCompletionResponse> {
    const config = this.fallbackConfigs.get(modelName);
    if (!config) {
      throw originalError;
    }

    // Choose fallback list: use context_window_fallbacks for context length errors
    const isContextWindowError = this.isContextWindowError(originalError);
    const fallbackModels = isContextWindowError
      ? (config.contextWindowFallbacks ?? config.fallbacks)
      : config.fallbacks;

    let lastError: Error = originalError;

    for (const fallbackModel of fallbackModels) {
      try {
        this.logger.log(
          `Attempting fallback from ${modelName} to ${fallbackModel}`,
        );
        const fallbackRequest = { ...request, model: fallbackModel };
        return await providerCallFn(fallbackModel, fallbackRequest);
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(
          `Fallback to ${fallbackModel} failed: ${(error as Error).message}`,
        );
      }
    }

    throw lastError;
  }

  private isContextWindowError(error: Error): boolean {
    const message = error.message?.toLowerCase() ?? '';
    return (
      message.includes('context_length_exceeded') ||
      message.includes('context window') ||
      message.includes('maximum context length') ||
      (error as ProviderError).code === 'context_length_exceeded'
    );
  }
}
