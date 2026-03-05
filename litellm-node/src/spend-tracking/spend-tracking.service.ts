import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CostCalculatorService } from './cost-calculator.service';
import { SpendBufferService } from './spend-buffer.service';
import { SpendLogParams } from './types/spend-log';

@Injectable()
export class SpendTrackingService {
  private readonly logger = new Logger(SpendTrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly costCalculator: CostCalculatorService,
    private readonly spendBuffer: SpendBufferService,
  ) {}

  /**
   * Fire-and-forget: caller does NOT await this.
   * Calculates cost and buffers the spend log entry for batch insert.
   */
  async logSpend(params: SpendLogParams): Promise<void> {
    try {
      const cost = this.costCalculator.calculateCost(params.model, params.usage);

      this.spendBuffer.add({
        request_id: params.requestId,
        call_type: params.callType,
        api_key: params.apiKeyHash,
        spend: cost,
        total_tokens: params.usage.total_tokens,
        prompt_tokens: params.usage.prompt_tokens,
        completion_tokens: params.usage.completion_tokens,
        model: params.model,
        user: params.userId,
        team_id: params.teamId,
        organization_id: params.orgId,
        startTime: params.startTime,
        endTime: params.endTime,
        metadata: params.metadata,
      });

      // Fire-and-forget key spend update
      if (params.apiKeyHash && cost > 0) {
        void this.updateKeySpend(params.apiKeyHash, cost);
      }
    } catch (error) {
      this.logger.error(
        `Failed to log spend for request ${params.requestId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Updates the cumulative spend on the API key record.
   */
  async updateKeySpend(apiKeyHash: string, cost: number): Promise<void> {
    try {
      await this.prisma.liteLLM_VerificationToken.update({
        where: { token: apiKeyHash },
        data: { spend: { increment: cost } },
      });
    } catch (error) {
      this.logger.error(
        `Failed to update key spend for ${apiKeyHash}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

}
