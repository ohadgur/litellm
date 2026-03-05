import { Injectable } from '@nestjs/common';

import { Deployment, RoutingContext } from '../types/routing';
import { IRoutingStrategy } from './strategy.interface';

/**
 * Selects the deployment with the lowest number of in-flight requests.
 * Falls back to random selection when no in-flight data is available.
 */
@Injectable()
export class LeastBusyStrategy implements IRoutingStrategy {
  select(deployments: Deployment[], context: RoutingContext): Deployment {
    if (deployments.length === 0) {
      throw new Error('No deployments available for selection');
    }

    if (deployments.length === 1) {
      return deployments[0];
    }

    const inFlightCounts = context.inFlightCounts;
    if (!inFlightCounts || inFlightCounts.size === 0) {
      return deployments[Math.floor(Math.random() * deployments.length)];
    }

    let minCount = Infinity;
    let candidates: Deployment[] = [];

    for (const deployment of deployments) {
      const count = inFlightCounts.get(deployment.id) ?? 0;
      if (count < minCount) {
        minCount = count;
        candidates = [deployment];
      } else if (count === minCount) {
        candidates.push(deployment);
      }
    }

    return candidates[Math.floor(Math.random() * candidates.length)];
  }
}
