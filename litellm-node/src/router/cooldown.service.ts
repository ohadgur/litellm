import { Injectable } from '@nestjs/common';

import { Deployment, DeploymentHealth } from './types/routing';

const DEFAULT_COOLDOWN_DURATION_MS = 60_000;
const FAILURE_WINDOW_MS = 60_000;

/**
 * Tracks failed deployments and manages cooldown periods.
 *
 * When a deployment fails, it enters a cooldown period during which
 * it will be excluded from routing decisions. The cooldown duration
 * is configurable and defaults to 60 seconds.
 */
@Injectable()
export class CooldownService {
  private readonly healthMap = new Map<string, DeploymentHealth>();
  private readonly cooldownDurationMs: number;

  constructor(cooldownDurationMs?: number) {
    this.cooldownDurationMs = cooldownDurationMs ?? DEFAULT_COOLDOWN_DURATION_MS;
  }

  markFailed(deploymentId: string, _error: Error): void {
    const now = Date.now();
    const existing = this.healthMap.get(deploymentId);

    const withinWindow =
      existing != null &&
      existing.lastFailure != null &&
      now - existing.lastFailure < FAILURE_WINDOW_MS;

    const failureCount = withinWindow ? existing!.failureCount + 1 : 1;

    this.healthMap.set(deploymentId, {
      deploymentId,
      isHealthy: false,
      cooldownUntil: now + this.cooldownDurationMs,
      failureCount,
      lastFailure: now,
    });
  }

  isAvailable(deploymentId: string): boolean {
    const health = this.healthMap.get(deploymentId);
    if (!health) {
      return true;
    }

    if (health.cooldownUntil != null && Date.now() >= health.cooldownUntil) {
      // Cooldown expired, clear it
      this.healthMap.delete(deploymentId);
      return true;
    }

    return health.isHealthy;
  }

  getHealthyDeployments(deployments: Deployment[]): Deployment[] {
    return deployments.filter((d) => this.isAvailable(d.id));
  }

  /** Visible for testing: get the current health record. */
  getHealth(deploymentId: string): DeploymentHealth | undefined {
    return this.healthMap.get(deploymentId);
  }

  /** Visible for testing: clear all state. */
  clear(): void {
    this.healthMap.clear();
  }
}
