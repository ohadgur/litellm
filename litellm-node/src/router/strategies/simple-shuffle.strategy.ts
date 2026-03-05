import { Injectable } from '@nestjs/common';

import { Deployment, RoutingContext } from '../types/routing';
import { IRoutingStrategy } from './strategy.interface';

/**
 * Weighted random selection from healthy deployments.
 *
 * If deployments have `weight`, `rpm`, or `tpm` set in litellmParams,
 * performs a weighted random pick. Otherwise, uniform random.
 */
@Injectable()
export class SimpleShuffleStrategy implements IRoutingStrategy {
  select(deployments: Deployment[], _context: RoutingContext): Deployment {
    if (deployments.length === 0) {
      throw new Error('No deployments available for selection');
    }

    if (deployments.length === 1) {
      return deployments[0];
    }

    for (const weightKey of ['weight', 'rpm', 'tpm'] as const) {
      const firstWeight = deployments[0].litellmParams[weightKey];
      if (firstWeight != null && typeof firstWeight === 'number') {
        return this.weightedPick(deployments, weightKey);
      }
    }

    return deployments[Math.floor(Math.random() * deployments.length)];
  }

  private weightedPick(
    deployments: Deployment[],
    weightKey: string,
  ): Deployment {
    const weights = deployments.map(
      (d) => (d.litellmParams[weightKey] as number) || 0,
    );
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);

    if (totalWeight === 0) {
      return deployments[Math.floor(Math.random() * deployments.length)];
    }

    const normalizedWeights = weights.map((w) => w / totalWeight);
    const rand = Math.random();
    let cumulative = 0;

    for (let i = 0; i < normalizedWeights.length; i++) {
      cumulative += normalizedWeights[i];
      if (rand <= cumulative) {
        return deployments[i];
      }
    }

    return deployments[deployments.length - 1];
  }
}
