import { Injectable } from '@nestjs/common';

import { Deployment, RoutingContext } from '../types/routing';
import { IRoutingStrategy } from './strategy.interface';

/**
 * Selects the deployment with the lowest rolling latency (p50).
 * Falls back to random selection when no latency data is available.
 */
@Injectable()
export class LowestLatencyStrategy implements IRoutingStrategy {
  select(deployments: Deployment[], context: RoutingContext): Deployment {
    if (deployments.length === 0) {
      throw new Error('No deployments available for selection');
    }

    if (deployments.length === 1) {
      return deployments[0];
    }

    const latencyMap = context.latencyMap;
    if (!latencyMap || latencyMap.size === 0) {
      return deployments[Math.floor(Math.random() * deployments.length)];
    }

    let minLatency = Infinity;
    let candidates: Deployment[] = [];

    for (const deployment of deployments) {
      const latency = latencyMap.get(deployment.id);
      if (latency == null) {
        // Deployments with no data get priority (explore them)
        candidates = [deployment];
        minLatency = -1;
        break;
      }
      if (latency < minLatency) {
        minLatency = latency;
        candidates = [deployment];
      } else if (latency === minLatency) {
        candidates.push(deployment);
      }
    }

    return candidates[Math.floor(Math.random() * candidates.length)];
  }
}
