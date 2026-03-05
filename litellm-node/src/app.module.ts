import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { ConfigModule } from './config/config.module';
import { AuthModule } from './auth/auth.module';
import { CacheModule } from './cache/cache.module';
import { StreamingModule } from './streaming/streaming.module';
import { RouterModule } from './router/router.module';
import { SpendTrackingModule } from './spend-tracking/spend-tracking.module';
import { GatewayModule } from './gateway/gateway.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    AuthModule,
    CacheModule,
    StreamingModule,
    RouterModule,
    SpendTrackingModule,
    GatewayModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
