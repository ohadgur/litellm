import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import NodeCache from 'node-cache';
import Redis from 'ioredis';

export interface DualCacheOptions {
  /** Maximum number of entries in the in-memory LRU cache. Default: 1000 */
  inMemoryMaxSize?: number;
  /** Default TTL in seconds for in-memory cache entries. Default: 600 */
  inMemoryTtlSeconds?: number;
  /** Redis connection URL. If omitted, Redis is disabled. */
  redisUrl?: string;
}

@Injectable()
export class DualCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(DualCacheService.name);
  private readonly memoryCache: NodeCache;
  private readonly redis: Redis | null;

  constructor(options: DualCacheOptions = {}) {
    this.memoryCache = new NodeCache({
      stdTTL: options.inMemoryTtlSeconds ?? 600,
      maxKeys: options.inMemoryMaxSize ?? 1000,
      checkperiod: 120,
      useClones: false,
    });

    if (options.redisUrl) {
      try {
        this.redis = new Redis(options.redisUrl, {
          maxRetriesPerRequest: 1,
          retryStrategy: (times: number) => (times > 3 ? null : Math.min(times * 200, 2000)),
          lazyConnect: true,
        });
        this.redis.connect().catch((err: Error) => {
          this.logger.warn(`Redis connection failed, running without Redis: ${err.message}`);
        });
      } catch (err) {
        this.logger.warn(`Failed to create Redis client: ${(err as Error).message}`);
        this.redis = null;
      }
    } else {
      this.redis = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.memoryCache.close();
    if (this.redis) {
      await this.redis.quit().catch(() => {});
    }
  }

  /**
   * Get a value from cache. Checks in-memory first, then Redis.
   * On Redis hit, backfills in-memory cache.
   */
  async get<T>(key: string): Promise<T | null> {
    // Check in-memory first
    const memValue = this.memoryCache.get<T>(key);
    if (memValue !== undefined) {
      return memValue;
    }

    // Fallback to Redis
    if (this.redis) {
      try {
        const raw = await this.redis.get(key);
        if (raw !== null) {
          const parsed = JSON.parse(raw) as T;
          // Backfill in-memory cache (use remaining Redis TTL if available)
          const ttl = await this.redis.ttl(key);
          if (ttl > 0) {
            this.memoryCache.set(key, parsed, ttl);
          } else {
            this.memoryCache.set(key, parsed);
          }
          return parsed;
        }
      } catch (err) {
        this.logger.warn(`Redis get failed for key ${key}: ${(err as Error).message}`);
      }
    }

    return null;
  }

  /**
   * Set a value in both in-memory and Redis caches.
   */
  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    // Write to in-memory
    if (ttlSeconds !== undefined && ttlSeconds > 0) {
      this.memoryCache.set(key, value, ttlSeconds);
    } else {
      this.memoryCache.set(key, value);
    }

    // Write to Redis (fire-and-forget with error handling)
    if (this.redis) {
      try {
        const serialized = JSON.stringify(value);
        if (ttlSeconds !== undefined && ttlSeconds > 0) {
          await this.redis.setex(key, ttlSeconds, serialized);
        } else {
          await this.redis.set(key, serialized);
        }
      } catch (err) {
        this.logger.warn(`Redis set failed for key ${key}: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Delete a key from both caches.
   */
  async del(key: string): Promise<void> {
    this.memoryCache.del(key);
    if (this.redis) {
      try {
        await this.redis.del(key);
      } catch (err) {
        this.logger.warn(`Redis del failed for key ${key}: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Increment a numeric counter atomically.
   * Uses Redis INCR when available, in-memory fallback otherwise.
   * Returns the new counter value.
   */
  async increment(key: string, ttlSeconds: number): Promise<number> {
    // If Redis is available, try it as the source of truth for counters
    if (this.redis) {
      try {
        const pipeline = this.redis.pipeline();
        pipeline.incr(key);
        pipeline.expire(key, ttlSeconds);
        const results = await pipeline.exec();
        // results is [[error, value], [error, value]] -- check first command succeeded
        if (results && results[0] && results[0][0] === null && typeof results[0][1] === 'number') {
          const newValue = results[0][1];
          // Mirror to in-memory for fast reads
          this.memoryCache.set(key, newValue, ttlSeconds);
          return newValue;
        }
      } catch (err) {
        this.logger.warn(`Redis increment failed for key ${key}: ${(err as Error).message}`);
      }
    }

    // Fallback: in-memory only
    const current = this.memoryCache.get<number>(key) ?? 0;
    const newValue = current + 1;
    this.memoryCache.set(key, newValue, ttlSeconds);
    return newValue;
  }

  /**
   * Get a numeric counter value.
   */
  async getCounter(key: string): Promise<number> {
    const value = await this.get<number>(key);
    return value ?? 0;
  }

  /** Expose whether Redis is configured (for testing). */
  get hasRedis(): boolean {
    return this.redis !== null;
  }
}
