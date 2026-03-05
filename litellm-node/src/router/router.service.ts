import { Injectable, Logger } from '@nestjs/common';

import { CooldownService } from './cooldown.service';
import { DeploymentSelectorService } from './deployment-selector.service';
import { FallbackService, ProviderCallFn } from './fallback.service';
import { RetryService } from './retry.service';
import {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  Deployment,
  ModelConfig,
  RoutingContext,
  RoutingStrategy,
} from './types/routing';

/**
 * Provider function type that the router delegates actual LLM calls to.
 * This should be injected or set by the consumer of the RouterService.
 */
export type ProviderExecuteFn = (
  deployment: Deployment,
  request: ChatCompletionRequest,
  stream: boolean,
) => Promise<ChatCompletionResponse | AsyncIterable<ChatCompletionChunk>>;

@Injectable()
export class RouterService {
  private readonly logger = new Logger(RouterService.name);
  private readonly modelConfigs = new Map<string, ModelConfig>();
  private readonly inFlightCounts = new Map<string, number>();
  private providerExecuteFn?: ProviderExecuteFn;

  constructor(
    private readonly cooldownService: CooldownService,
    private readonly deploymentSelector: DeploymentSelectorService,
    private readonly fallbackService: FallbackService,
    private readonly retryService: RetryService,
  ) {}

  /** Register model configurations for routing. */
  registerModels(configs: ModelConfig[]): void {
    for (const config of configs) {
      this.modelConfigs.set(config.modelName, config);
    }

    // Register fallback configs
    const fallbackConfigs = configs
      .filter((c) => c.fallbacks && c.fallbacks.length > 0)
      .map((c) => ({
        modelName: c.modelName,
        fallbacks: c.fallbacks!,
        contextWindowFallbacks: c.contextWindowFallbacks,
      }));
    this.fallbackService.registerFallbacks(fallbackConfigs);
  }

  /** Set the provider execution function for making actual LLM calls. */
  setProviderExecuteFn(fn: ProviderExecuteFn): void {
    this.providerExecuteFn = fn;
  }

  /**
   * Route a request to the best available deployment.
   *
   * 1. Get deployments for model from config
   * 2. Filter out cooled-down deployments
   * 3. Select deployment via strategy
   * 4. Execute provider call (with retry)
   * 5. On failure: mark cooldown, try fallback
   * 6. Return response
   */
  async route(
    modelName: string,
    request: ChatCompletionRequest,
    stream: boolean = false,
  ): Promise<ChatCompletionResponse | AsyncIterable<ChatCompletionChunk>> {
    const config = this.modelConfigs.get(modelName);
    if (!config) {
      throw new Error(`No configuration found for model: ${modelName}`);
    }

    const strategy = config.strategy ?? RoutingStrategy.SIMPLE_SHUFFLE;
    const healthyDeployments = this.cooldownService.getHealthyDeployments(
      config.deployments,
    );

    if (healthyDeployments.length === 0) {
      this.logger.warn(
        `All deployments for ${modelName} are in cooldown. Trying all deployments.`,
      );
      // Fall through to try all deployments anyway
      return this.executeWithDeployment(
        config.deployments,
        strategy,
        modelName,
        request,
        stream,
      );
    }

    try {
      return await this.executeWithDeployment(
        healthyDeployments,
        strategy,
        modelName,
        request,
        stream,
      );
    } catch (error) {
      // Try fallback if available
      if (config.fallbacks && config.fallbacks.length > 0) {
        const fallbackProviderFn: ProviderCallFn = async (
          fallbackModel: string,
          fallbackRequest: ChatCompletionRequest,
        ) => {
          const result = await this.route(fallbackModel, fallbackRequest, false);
          return result as ChatCompletionResponse;
        };

        return this.fallbackService.executeFallback(
          modelName,
          request,
          error as Error,
          fallbackProviderFn,
        );
      }

      throw error;
    }
  }

  private async executeWithDeployment(
    deployments: Deployment[],
    strategy: RoutingStrategy,
    modelName: string,
    request: ChatCompletionRequest,
    stream: boolean,
  ): Promise<ChatCompletionResponse | AsyncIterable<ChatCompletionChunk>> {
    const context = this.buildRoutingContext();
    const deployment = this.deploymentSelector.selectDeployment(
      deployments,
      strategy,
      context,
    );

    this.logger.debug(
      `Selected deployment ${deployment.id} for model ${modelName}`,
    );

    return this.retryService.executeWithRetry(async () => {
      this.incrementInFlight(deployment.id);
      try {
        const result = await this.executeProvider(deployment, request, stream);
        return result;
      } catch (error) {
        this.cooldownService.markFailed(deployment.id, error as Error);
        throw error;
      } finally {
        this.decrementInFlight(deployment.id);
      }
    });
  }

  private async executeProvider(
    deployment: Deployment,
    request: ChatCompletionRequest,
    stream: boolean,
  ): Promise<ChatCompletionResponse | AsyncIterable<ChatCompletionChunk>> {
    if (!this.providerExecuteFn) {
      throw new Error(
        'Provider execute function not set. Call setProviderExecuteFn first.',
      );
    }
    return this.providerExecuteFn(deployment, request, stream);
  }

  private buildRoutingContext(): RoutingContext {
    return {
      inFlightCounts: new Map(this.inFlightCounts),
    };
  }

  private incrementInFlight(deploymentId: string): void {
    const current = this.inFlightCounts.get(deploymentId) ?? 0;
    this.inFlightCounts.set(deploymentId, current + 1);
  }

  private decrementInFlight(deploymentId: string): void {
    const current = this.inFlightCounts.get(deploymentId) ?? 0;
    this.inFlightCounts.set(deploymentId, Math.max(0, current - 1));
  }
}
