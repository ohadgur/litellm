import { FallbackService, ProviderCallFn } from '../../../src/router/fallback.service';
import {
  ChatCompletionRequest,
  ChatCompletionResponse,
} from '../../../src/router/types/routing';

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
        message: { role: 'assistant', content: 'Hi' },
        finish_reason: 'stop',
      },
    ],
  };
}

describe('FallbackService', () => {
  let service: FallbackService;

  beforeEach(() => {
    service = new FallbackService();
  });

  it('should throw original error when no fallback config exists', async () => {
    const originalError = new Error('Provider failed');
    const providerFn: ProviderCallFn = jest.fn();

    await expect(
      service.executeFallback('gpt-4', makeRequest('gpt-4'), originalError, providerFn),
    ).rejects.toThrow('Provider failed');

    expect(providerFn).not.toHaveBeenCalled();
  });

  it('should fall back to next model on failure', async () => {
    service.registerFallbacks([
      { modelName: 'gpt-4', fallbacks: ['gpt-3.5-turbo', 'claude-3'] },
    ]);

    const providerFn: ProviderCallFn = jest.fn().mockResolvedValue(
      makeResponse('gpt-3.5-turbo'),
    );

    const result = await service.executeFallback(
      'gpt-4',
      makeRequest('gpt-4'),
      new Error('gpt-4 failed'),
      providerFn,
    );

    expect(result.model).toBe('gpt-3.5-turbo');
    expect(providerFn).toHaveBeenCalledTimes(1);
  });

  it('should try subsequent fallbacks when earlier ones fail', async () => {
    service.registerFallbacks([
      { modelName: 'gpt-4', fallbacks: ['gpt-3.5-turbo', 'claude-3'] },
    ]);

    const providerFn: ProviderCallFn = jest
      .fn()
      .mockRejectedValueOnce(new Error('gpt-3.5-turbo also failed'))
      .mockResolvedValueOnce(makeResponse('claude-3'));

    const result = await service.executeFallback(
      'gpt-4',
      makeRequest('gpt-4'),
      new Error('gpt-4 failed'),
      providerFn,
    );

    expect(result.model).toBe('claude-3');
    expect(providerFn).toHaveBeenCalledTimes(2);
  });

  it('should throw last error when all fallbacks fail', async () => {
    service.registerFallbacks([
      { modelName: 'gpt-4', fallbacks: ['gpt-3.5-turbo', 'claude-3'] },
    ]);

    const providerFn: ProviderCallFn = jest
      .fn()
      .mockRejectedValueOnce(new Error('fallback 1 failed'))
      .mockRejectedValueOnce(new Error('fallback 2 failed'));

    await expect(
      service.executeFallback(
        'gpt-4',
        makeRequest('gpt-4'),
        new Error('gpt-4 failed'),
        providerFn,
      ),
    ).rejects.toThrow('fallback 2 failed');
  });

  it('should use contextWindowFallbacks for context length errors', async () => {
    service.registerFallbacks([
      {
        modelName: 'gpt-4',
        fallbacks: ['gpt-3.5-turbo'],
        contextWindowFallbacks: ['gpt-4-32k'],
      },
    ]);

    const providerFn: ProviderCallFn = jest.fn().mockResolvedValue(
      makeResponse('gpt-4-32k'),
    );

    const contextError = new Error('context_length_exceeded');
    const result = await service.executeFallback(
      'gpt-4',
      makeRequest('gpt-4'),
      contextError,
      providerFn,
    );

    expect(result.model).toBe('gpt-4-32k');
    // Verify the request was modified with the fallback model
    expect(providerFn).toHaveBeenCalledWith(
      'gpt-4-32k',
      expect.objectContaining({ model: 'gpt-4-32k' }),
    );
  });
});
