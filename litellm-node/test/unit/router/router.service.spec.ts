import { CooldownService } from '../../../src/router/cooldown.service';
import { DeploymentSelectorService } from '../../../src/router/deployment-selector.service';
import { FallbackService } from '../../../src/router/fallback.service';
import { RetryService } from '../../../src/router/retry.service';
import { RouterService, ProviderExecuteFn } from '../../../src/router/router.service';
import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  Deployment,
  ProviderError,
  RoutingStrategy,
} from '../../../src/router/types/routing';

function makeDeployment(id: string, model: string = 'gpt-4'): Deployment {
  return {
    id,
    modelName: model,
    litellmParams: { model },
    modelInfo: { id },
  };
}

function makeRequest(model: string): ChatCompletionRequest {
  return {
    model,
    messages: [{ role: 'user', content: 'Hello' }],
  };
}

function makeResponse(model: string): ChatCompletionResponse {
  return {
    id: 'resp-1',
    object: 'chat.completion',
    created: Date.now(),
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'Hi there' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
  };
}

describe('RouterService', () => {
  let routerService: RouterService;
  let cooldownService: CooldownService;
  let deploymentSelector: DeploymentSelectorService;
  let fallbackService: FallbackService;
  let retryService: RetryService;
  let mockProviderFn: jest.Mock;

  beforeEach(() => {
    cooldownService = new CooldownService(1_000);
    deploymentSelector = new DeploymentSelectorService();
    fallbackService = new FallbackService();
    retryService = new RetryService({ maxRetries: 2, baseDelayMs: 10, maxDelayMs: 50 });

    routerService = new RouterService(
      cooldownService,
      deploymentSelector,
      fallbackService,
      retryService,
    );

    mockProviderFn = jest.fn().mockResolvedValue(makeResponse('gpt-4'));
    routerService.setProviderExecuteFn(mockProviderFn as ProviderExecuteFn);
  });

  it('should route to correct provider based on model config', async () => {
    routerService.registerModels([
      {
        modelName: 'gpt-4',
        deployments: [makeDeployment('d1', 'gpt-4')],
        strategy: RoutingStrategy.SIMPLE_SHUFFLE,
      },
    ]);

    const result = await routerService.route('gpt-4', makeRequest('gpt-4'));
    expect(result).toBeDefined();
    expect((result as ChatCompletionResponse).model).toBe('gpt-4');
    expect(mockProviderFn).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'd1' }),
      expect.any(Object),
      false,
    );
  });

  it('should throw when model config is not found', async () => {
    await expect(
      routerService.route('unknown-model', makeRequest('unknown-model')),
    ).rejects.toThrow('No configuration found for model: unknown-model');
  });

  it('should skip cooled-down deployments', async () => {
    routerService.registerModels([
      {
        modelName: 'gpt-4',
        deployments: [
          makeDeployment('d1', 'gpt-4'),
          makeDeployment('d2', 'gpt-4'),
        ],
        strategy: RoutingStrategy.SIMPLE_SHUFFLE,
      },
    ]);

    cooldownService.markFailed('d1', new Error('failed'));

    // Run multiple times to confirm d1 is never selected
    for (let i = 0; i < 20; i++) {
      await routerService.route('gpt-4', makeRequest('gpt-4'));
    }

    for (const call of mockProviderFn.mock.calls) {
      expect(call[0].id).toBe('d2');
    }
  });

  it('should handle fallback on provider failure', async () => {
    routerService.registerModels([
      {
        modelName: 'gpt-4',
        deployments: [makeDeployment('d1', 'gpt-4')],
        fallbacks: ['gpt-3.5-turbo'],
      },
      {
        modelName: 'gpt-3.5-turbo',
        deployments: [makeDeployment('d2', 'gpt-3.5-turbo')],
      },
    ]);

    const authError: ProviderError = new Error('Unauthorized') as ProviderError;
    authError.status = 401;

    mockProviderFn
      .mockRejectedValueOnce(authError) // gpt-4 fails (non-retryable)
      .mockResolvedValueOnce(makeResponse('gpt-3.5-turbo'));

    const result = await routerService.route('gpt-4', makeRequest('gpt-4'));
    expect((result as ChatCompletionResponse).model).toBe('gpt-3.5-turbo');
  });

  it('should retry on rate limit errors', async () => {
    routerService.registerModels([
      {
        modelName: 'gpt-4',
        deployments: [makeDeployment('d1', 'gpt-4')],
      },
    ]);

    const rateLimitError: ProviderError = new Error('Rate limited') as ProviderError;
    rateLimitError.status = 429;

    mockProviderFn
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce(makeResponse('gpt-4'));

    const result = await routerService.route('gpt-4', makeRequest('gpt-4'));
    expect((result as ChatCompletionResponse).model).toBe('gpt-4');
    // 1 failed attempt + 1 successful retry
    expect(mockProviderFn).toHaveBeenCalledTimes(2);
  });

  it('should not retry on auth errors', async () => {
    routerService.registerModels([
      {
        modelName: 'gpt-4',
        deployments: [makeDeployment('d1', 'gpt-4')],
      },
    ]);

    const authError: ProviderError = new Error('Forbidden') as ProviderError;
    authError.status = 403;

    mockProviderFn.mockRejectedValue(authError);

    await expect(
      routerService.route('gpt-4', makeRequest('gpt-4')),
    ).rejects.toThrow('Forbidden');

    // Should only try once (no retries for 403)
    expect(mockProviderFn).toHaveBeenCalledTimes(1);
  });
});
