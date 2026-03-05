import { Injectable } from '@nestjs/common';

import { LeastBusyStrategy } from './strategies/least-busy.strategy';
import { LowestLatencyStrategy } from './strategies/lowest-latency.strategy';
import { LowestTpmRpmStrategy } from './strategies/lowest-tpm-rpm.strategy';
import { SimpleShuffleStrategy } from './strategies/simple-shuffle.strategy';
import { IRoutingStrategy } from './strategies/strategy.interface';
import { Deployment, RoutingContext, RoutingStrategy } from './types/routing';

@Injectable()
export class DeploymentSelectorService {
  private readonly strategies: Record<RoutingStrategy, IRoutingStrategy>;

  constructor() {
    this.strategies = {
      [RoutingStrategy.SIMPLE_SHUFFLE]: new SimpleShuffleStrategy(),
      [RoutingStrategy.LEAST_BUSY]: new LeastBusyStrategy(),
      [RoutingStrategy.LOWEST_LATENCY]: new LowestLatencyStrategy(),
      [RoutingStrategy.LOWEST_TPM_RPM]: new LowestTpmRpmStrategy(),
    };
  }

  selectDeployment(
    deployments: Deployment[],
    strategy: RoutingStrategy,
    context?: RoutingContext,
  ): Deployment {
    if (deployments.length === 0) {
      throw new Error('No deployments available');
    }

    const strategyImpl = this.strategies[strategy];
    if (!strategyImpl) {
      throw new Error(`Unknown routing strategy: ${strategy}`);
    }

    return strategyImpl.select(deployments, context ?? {});
  }
}
