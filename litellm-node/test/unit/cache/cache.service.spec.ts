import { CacheService, ChatCompletionResponse } from '../../../src/cache/cache.service';
import { DualCacheService } from '../../../src/cache/dual-cache.service';
import { CacheKeyBuilder } from '../../../src/cache/cache-key.builder';

describe('CacheService', () => {
  let cacheService: CacheService;
  let dualCache: DualCacheService;
  const keyBuilder = new CacheKeyBuilder();

  const sampleResponse: ChatCompletionResponse = {
    id: 'chatcmpl-abc123',
    object: 'chat.completion',
    created: 1700000000,
    model: 'gpt-4',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'Hello!' },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    },
  };

  beforeEach(() => {
    dualCache = new DualCacheService({
      inMemoryMaxSize: 100,
      inMemoryTtlSeconds: 60,
    });
    cacheService = new CacheService(dualCache);
  });

  afterEach(async () => {
    await dualCache.onModuleDestroy();
  });

  describe('getCachedResponse / setCachedResponse', () => {
    it('should return null on cache miss', async () => {
      const result = await cacheService.getCachedResponse('missing-key');
      expect(result).toBeNull();
    });

    it('should store and retrieve a response', async () => {
      const key = keyBuilder.buildResponseCacheKey(
        'gpt-4',
        [{ role: 'user', content: 'hi' }],
        {},
      );
      await cacheService.setCachedResponse(key, sampleResponse);
      const result = await cacheService.getCachedResponse(key);
      expect(result).toEqual(sampleResponse);
    });

    it('should store a response with TTL', async () => {
      const key = 'ttl-response-key';
      await cacheService.setCachedResponse(key, sampleResponse, 1);
      const before = await cacheService.getCachedResponse(key);
      expect(before).toEqual(sampleResponse);

      await new Promise((resolve) => setTimeout(resolve, 1100));

      const after = await cacheService.getCachedResponse(key);
      expect(after).toBeNull();
    }, 5000);
  });

  describe('incrementCounter / getCounter', () => {
    it('should increment from zero and return 1', async () => {
      const result = await cacheService.incrementCounter('rpm:deploy-1:0', 60);
      expect(result).toBe(1);
    });

    it('should increment sequentially', async () => {
      await cacheService.incrementCounter('rpm:deploy-1:1', 60);
      await cacheService.incrementCounter('rpm:deploy-1:1', 60);
      const result = await cacheService.incrementCounter('rpm:deploy-1:1', 60);
      expect(result).toBe(3);
    });

    it('should get counter value after increments', async () => {
      await cacheService.incrementCounter('tpm:deploy-1:0', 60);
      await cacheService.incrementCounter('tpm:deploy-1:0', 60);
      const result = await cacheService.getCounter('tpm:deploy-1:0');
      expect(result).toBe(2);
    });

    it('should return zero for nonexistent counter', async () => {
      const result = await cacheService.getCounter('nonexistent-counter');
      expect(result).toBe(0);
    });
  });

  describe('invalidate', () => {
    it('should remove cached response', async () => {
      const key = 'to-invalidate';
      await cacheService.setCachedResponse(key, sampleResponse);
      await cacheService.invalidate(key);
      const result = await cacheService.getCachedResponse(key);
      expect(result).toBeNull();
    });
  });
});
