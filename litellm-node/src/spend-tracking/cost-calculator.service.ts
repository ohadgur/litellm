import { Injectable, Logger } from '@nestjs/common';
import { ModelPricing } from './types/spend-log';
import modelPrices from './data/model-prices.json';

@Injectable()
export class CostCalculatorService {
  private readonly logger = new Logger(CostCalculatorService.name);
  private readonly prices: Record<string, ModelPricing>;

  constructor() {
    this.prices = modelPrices as Record<string, ModelPricing>;
  }

  calculateCost(
    model: string,
    usage: { prompt_tokens: number; completion_tokens: number },
  ): number {
    const pricing = this.prices[model];
    if (!pricing) {
      this.logger.debug(`No pricing found for model: ${model}, returning 0`);
      return 0;
    }

    const inputCost = usage.prompt_tokens * pricing.input_cost_per_token;
    const outputCost = usage.completion_tokens * pricing.output_cost_per_token;

    return inputCost + outputCost;
  }

  hasModel(model: string): boolean {
    return model in this.prices;
  }
}
