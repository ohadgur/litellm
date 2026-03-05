import { Module } from '@nestjs/common';
import { CacheService } from './cache.service';
import { DualCacheService } from './dual-cache.service';
import { CacheKeyBuilder } from './cache-key.builder';

@Module({
  providers: [
    {
      provide: DualCacheService,
      useFactory: () => {
        return new DualCacheService({
          inMemoryMaxSize: parseInt(process.env['CACHE_MEMORY_MAX_SIZE'] ?? '1000', 10),
          inMemoryTtlSeconds: parseInt(process.env['CACHE_MEMORY_TTL_SECONDS'] ?? '600', 10),
          redisUrl: process.env['REDIS_URL'],
        });
      },
    },
    CacheKeyBuilder,
    CacheService,
  ],
  exports: [CacheService, CacheKeyBuilder, DualCacheService],
})
export class CacheModule {}
