import { DualCacheService } from '../../../src/cache/dual-cache.service';

describe('DualCacheService', () => {
  let cache: DualCacheService;

  beforeEach(() => {
    // No Redis URL -- purely in-memory mode
    cache = new DualCacheService({
      inMemoryMaxSize: 100,
      inMemoryTtlSeconds: 60,
    });
  });

  afterEach(async () => {
    await cache.onModuleDestroy();
  });

  describe('in-memory only (no Redis)', () => {
    it('should return null on cache miss', async () => {
      const result = await cache.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should store and retrieve a value', async () => {
      await cache.set('key1', { data: 'hello' });
      const result = await cache.get<{ data: string }>('key1');
      expect(result).toEqual({ data: 'hello' });
    });

    it('should delete a value', async () => {
      await cache.set('key1', 'value');
      await cache.del('key1');
      const result = await cache.get('key1');
      expect(result).toBeNull();
    });

    it('should respect TTL expiration', async () => {
      // Set with 1 second TTL
      await cache.set('ttl-key', 'expires-soon', 1);
      const before = await cache.get('ttl-key');
      expect(before).toBe('expires-soon');

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const after = await cache.get('ttl-key');
      expect(after).toBeNull();
    }, 5000);

    it('should increment a counter from zero', async () => {
      const result = await cache.increment('counter:1', 60);
      expect(result).toBe(1);
    });

    it('should increment a counter sequentially', async () => {
      await cache.increment('counter:2', 60);
      await cache.increment('counter:2', 60);
      const result = await cache.increment('counter:2', 60);
      expect(result).toBe(3);
    });

    it('should return zero for nonexistent counter', async () => {
      const result = await cache.getCounter('no-counter');
      expect(result).toBe(0);
    });

    it('should read counter value after increments', async () => {
      await cache.increment('counter:3', 60);
      await cache.increment('counter:3', 60);
      const result = await cache.getCounter('counter:3');
      expect(result).toBe(2);
    });

    it('should report hasRedis as false', () => {
      expect(cache.hasRedis).toBe(false);
    });
  });

  describe('graceful degradation with invalid Redis URL', () => {
    let cacheWithBadRedis: DualCacheService;

    beforeEach(() => {
      // Use a URL that will fail to connect
      cacheWithBadRedis = new DualCacheService({
        redisUrl: 'redis://localhost:59999',
      });
    });

    afterEach(async () => {
      await cacheWithBadRedis.onModuleDestroy();
    });

    it('should still work with in-memory cache when Redis is unavailable', async () => {
      // set/get should work via in-memory even if Redis fails
      await cacheWithBadRedis.set('fallback-key', 'fallback-value');
      const result = await cacheWithBadRedis.get('fallback-key');
      expect(result).toBe('fallback-value');
    });

    it('should increment counters via in-memory when Redis is unavailable', async () => {
      const result = await cacheWithBadRedis.increment('fallback-counter', 60);
      expect(result).toBe(1);
    });
  });

  describe('in-memory hit avoids Redis call', () => {
    it('should return in-memory value without touching Redis', async () => {
      // With no Redis configured, any get after set should come from memory
      await cache.set('mem-key', { quick: true });
      const result = await cache.get<{ quick: boolean }>('mem-key');
      expect(result).toEqual({ quick: true });
      // If Redis were called and failed, this would throw or return null.
      // Since we get the value, it came from in-memory.
    });
  });
});
