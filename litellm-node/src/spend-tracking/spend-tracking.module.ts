import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CostCalculatorService } from './cost-calculator.service';
import { SpendBufferService } from './spend-buffer.service';
import { SpendTrackingService } from './spend-tracking.service';

@Module({
  imports: [PrismaModule],
  providers: [CostCalculatorService, SpendBufferService, SpendTrackingService],
  exports: [SpendTrackingService, CostCalculatorService],
})
export class SpendTrackingModule {}
