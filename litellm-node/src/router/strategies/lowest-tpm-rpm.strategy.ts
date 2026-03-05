import { Injectable } from '@nestjs/common';

import { Deployment, RoutingContext } from '../types/routing';
import { IRoutingStrategy } from './strategy.interface';

/**
 * Selects the deployment with the most remaining TPM/RPM headroom.
 * Considers both TPM and RPM limits, picking the deployment with the
 * highest remaining capacity ratio.
 */
@Injectable()
export class LowestTpmRpmStrategy implements IRoutingStrategy {
  select(deployments: Deployment[], context: RoutingContext): Deployment {
    if (deployments.length === 0) {
      throw new Error('No deployments available for selection');
    }

    if (deployments.length === 1) {
      return deployments[0];
    }

    const { tpmUsage, rpmUsage } = context;
    if ((!tpmUsage || tpmUsage.size === 0) && (!rpmUsage || rpmUsage.size === 0)) {
      return deployments[Math.floor(Math.random() * deployments.length)];
    }

    let maxHeadroom = -Infinity;
    let candidates: Deployment[] = [];

    for (const deployment of deployments) {
      const headroom = this.calculateHeadroom(deployment, tpmUsage, rpmUsage);
      if (headroom > maxHeadroom) {
        maxHeadroom = headroom;
        candidates = [deployment];
      } else if (headroom === maxHeadroom) {
        candidates.push(deployment);
      }
    }

    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  private calculateHeadroom(
    deployment: Deployment,
    tpmUsage?: Map<string, number>,
    rpmUsage?: Map<string, number>,
  ): number {
    const tpmLimit = deployment.litellmParams.tpm;
    const rpmLimit = deployment.litellmParams.rpm;

    const currentTpm = tpmUsage?.get(deployment.id) ?? 0;
    const currentRpm = rpmUsage?.get(deployment.id) ?? 0;

    let headroom = Infinity;

    if (tpmLimit != null && tpmLimit > 0) {
      headroom = Math.min(headroom, (tpmLimit - currentTpm) / tpmLimit);
    }

    if (rpmLimit != null && rpmLimit > 0) {
      headroom = Math.min(headroom, (rpmLimit - currentRpm) / rpmLimit);
    }

    // If no limits are set, treat as infinite headroom
    if (headroom === Infinity) {
      return 1;
    }

    return headroom;
  }
}
