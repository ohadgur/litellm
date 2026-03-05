import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CacheModule } from '../cache/cache.module';
import { ConfigModule } from '../config/config.module';
import { RouterModule } from '../router/router.module';
import { SpendTrackingModule } from '../spend-tracking/spend-tracking.module';
import { StreamingModule } from '../streaming/streaming.module';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';

@Module({
  imports: [
    AuthModule,
    CacheModule,
    ConfigModule,
    RouterModule,
    SpendTrackingModule,
    StreamingModule,
  ],
  controllers: [GatewayController],
  providers: [GatewayService],
  exports: [GatewayService],
})
export class GatewayModule {}
