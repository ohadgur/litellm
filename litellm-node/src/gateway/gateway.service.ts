import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CacheService, ChatCompletionResponse } from '../cache/cache.service';
import { CacheKeyBuilder } from '../cache/cache-key.builder';
import { ConfigService } from '../config/config.service';
import { RouterService } from '../router/router.service';
import { SpendTrackingService } from '../spend-tracking/spend-tracking.service';
import { ChatCompletionRequest } from '../shared/dto/chat-completion.dto';
import { EmbeddingRequest } from '../shared/dto/embedding.dto';
import { ModelListResponse, ModelObject } from '../shared/dto/models.dto';
import { UserAPIKeyAuth } from '../auth/types/api-key-auth';
import { ChatCompletionChunk } from '../streaming/types';

export { ChatCompletionResponse };

export interface ProcessRequestParams {
  body: ChatCompletionRequest;
  auth: UserAPIKeyAuth;
  stream: boolean;
}

@Injectable()
export class GatewayService {
  private readonly logger = new Logger(GatewayService.name);

  constructor(
    private readonly cacheService: CacheService,
    private readonly cacheKeyBuilder: CacheKeyBuilder,
    private readonly configService: ConfigService,
    private readonly routerService: RouterService,
    private readonly spendTrackingService: SpendTrackingService,
  ) {}

  async processRequest(
    params: ProcessRequestParams,
  ): Promise<ChatCompletionResponse | AsyncIterable<ChatCompletionChunk>> {
    const startTime = new Date();
    const requestId = this.generateRequestId();

    const messages = params.body.messages.map((m) => ({
      role: m.role,
      content: m.content ?? null,
    }));
    const cacheParams = { temperature: params.body.temperature, max_tokens: params.body.max_tokens };

    // Check cache for non-streaming requests
    const cacheKey = !params.stream
      ? this.cacheKeyBuilder.buildResponseCacheKey(params.body.model, messages, cacheParams)
      : null;

    if (cacheKey) {
      const cached = await this.cacheService.getCachedResponse(cacheKey);
      if (cached) {
        this.logger.debug(`Cache hit for request ${requestId}`);
        return cached;
      }
    }

    // Route to provider
    const result = await this.routerService.route(
      params.body.model,
      {
        model: params.body.model,
        messages: messages.map((m) => ({ ...m, content: m.content ?? '' })),
        stream: params.stream,
        temperature: params.body.temperature,
        max_tokens: params.body.max_tokens,
        top_p: params.body.top_p,
      },
      params.stream,
    );

    // For non-streaming: cache and log spend
    if (cacheKey) {
      const response = result as ChatCompletionResponse;
      void this.cacheService.setCachedResponse(cacheKey, response);

      if (response.usage) {
        void this.spendTrackingService.logSpend({
          requestId,
          callType: 'completion',
          model: params.body.model,
          usage: response.usage,
          apiKeyHash: params.auth.token,
          userId: params.auth.userId,
          teamId: params.auth.teamId,
          orgId: params.auth.orgId,
          startTime,
          endTime: new Date(),
        });
      }

      return response;
    }

    return result as AsyncIterable<ChatCompletionChunk>;
  }

  async processEmbedding(
    body: EmbeddingRequest,
    auth: UserAPIKeyAuth,
  ): Promise<Record<string, unknown>> {
    // Embedding support delegates to the router in a full implementation.
    // For now, verify the model exists.
    const deployments = this.configService.getDeployments(body.model);
    if (deployments.length === 0) {
      throw new NotFoundException(`Model '${body.model}' not found`);
    }
    throw new Error(`Embedding provider not yet implemented for model: ${body.model}`);
  }

  listModels(): ModelListResponse {
    const modelNames = this.configService.getAllModelNames();
    const now = Math.floor(Date.now() / 1000);

    const data: ModelObject[] = modelNames.map((name) => ({
      id: name,
      object: 'model',
      created: now,
      owned_by: 'litellm',
    }));

    return {
      object: 'list',
      data,
    };
  }

  getModel(modelId: string): ModelObject {
    const modelNames = this.configService.getAllModelNames();
    if (!modelNames.includes(modelId)) {
      throw new NotFoundException(`Model '${modelId}' not found`);
    }

    return {
      id: modelId,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'litellm',
    };
  }

  private generateRequestId(): string {
    return `chatcmpl-${randomUUID()}`;
  }
}
