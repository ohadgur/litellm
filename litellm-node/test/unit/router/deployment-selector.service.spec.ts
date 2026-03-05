import { DeploymentSelectorService } from '../../../src/router/deployment-selector.service';
import {
  Deployment,
  RoutingContext,
  RoutingStrategy,
} from '../../../src/router/types/routing';

function makeDeployment(id: string, overrides?: Partial<Deployment>): Deployment {
  return {
    id,
    modelName: 'gpt-4',
    litellmParams: { model: 'gpt-4' },
    modelInfo: { id },
    ...overrides,
  };
}

describe('DeploymentSelectorService', () => {
  let service: DeploymentSelectorService;

  beforeEach(() => {
    service = new DeploymentSelectorService();
  });

  it('should throw when no deployments are provided', () => {
    expect(() =>
      service.selectDeployment([], RoutingStrategy.SIMPLE_SHUFFLE),
    ).toThrow('No deployments available');
  });

  describe('simple-shuffle', () => {
    it('should return the only deployment when there is one', () => {
      const deployment = makeDeployment('d1');
      const result = service.selectDeployment(
        [deployment],
        RoutingStrategy.SIMPLE_SHUFFLE,
      );
      expect(result).toBe(deployment);
    });

    it('should distribute across deployments over many picks', () => {
      const deployments = [
        makeDeployment('d1'),
        makeDeployment('d2'),
        makeDeployment('d3'),
      ];

      const counts = new Map<string, number>();
      const iterations = 3000;
      for (let i = 0; i < iterations; i++) {
        const selected = service.selectDeployment(
          deployments,
          RoutingStrategy.SIMPLE_SHUFFLE,
        );
        counts.set(selected.id, (counts.get(selected.id) ?? 0) + 1);
      }

      // Each deployment should get roughly 1/3 of picks
      for (const [, count] of counts) {
        expect(count).toBeGreaterThan(iterations * 0.2);
        expect(count).toBeLessThan(iterations * 0.5);
      }
    });

    it('should respect weights when provided', () => {
      const deployments = [
        makeDeployment('d1', { litellmParams: { model: 'gpt-4', weight: 9 } }),
        makeDeployment('d2', { litellmParams: { model: 'gpt-4', weight: 1 } }),
      ];

      const counts = new Map<string, number>();
      const iterations = 2000;
      for (let i = 0; i < iterations; i++) {
        const selected = service.selectDeployment(
          deployments,
          RoutingStrategy.SIMPLE_SHUFFLE,
        );
        counts.set(selected.id, (counts.get(selected.id) ?? 0) + 1);
      }

      // d1 (weight 9) should get significantly more than d2 (weight 1)
      expect(counts.get('d1')!).toBeGreaterThan(counts.get('d2')!);
    });
  });

  describe('least-busy', () => {
    it('should select deployment with lowest in-flight count', () => {
      const deployments = [
        makeDeployment('d1'),
        makeDeployment('d2'),
        makeDeployment('d3'),
      ];

      const context: RoutingContext = {
        inFlightCounts: new Map([
          ['d1', 5],
          ['d2', 1],
          ['d3', 3],
        ]),
      };

      const result = service.selectDeployment(
        deployments,
        RoutingStrategy.LEAST_BUSY,
        context,
      );
      expect(result.id).toBe('d2');
    });

    it('should handle deployments with no in-flight data', () => {
      const deployments = [makeDeployment('d1'), makeDeployment('d2')];

      const context: RoutingContext = {
        inFlightCounts: new Map([['d1', 5]]),
      };

      // d2 has no in-flight data, defaults to 0, should be selected
      const result = service.selectDeployment(
        deployments,
        RoutingStrategy.LEAST_BUSY,
        context,
      );
      expect(result.id).toBe('d2');
    });
  });

  describe('lowest-latency', () => {
    it('should select deployment with lowest latency', () => {
      const deployments = [
        makeDeployment('d1'),
        makeDeployment('d2'),
        makeDeployment('d3'),
      ];

      const context: RoutingContext = {
        latencyMap: new Map([
          ['d1', 200],
          ['d2', 50],
          ['d3', 150],
        ]),
      };

      const result = service.selectDeployment(
        deployments,
        RoutingStrategy.LOWEST_LATENCY,
        context,
      );
      expect(result.id).toBe('d2');
    });

    it('should prefer deployments with no latency data (explore)', () => {
      const deployments = [
        makeDeployment('d1'),
        makeDeployment('d2'),
      ];

      const context: RoutingContext = {
        latencyMap: new Map([['d1', 200]]),
        // d2 has no latency data
      };

      const result = service.selectDeployment(
        deployments,
        RoutingStrategy.LOWEST_LATENCY,
        context,
      );
      expect(result.id).toBe('d2');
    });
  });

  describe('lowest-tpm-rpm', () => {
    it('should select deployment with most headroom', () => {
      const deployments = [
        makeDeployment('d1', {
          litellmParams: { model: 'gpt-4', tpm: 10000, rpm: 100 },
        }),
        makeDeployment('d2', {
          litellmParams: { model: 'gpt-4', tpm: 10000, rpm: 100 },
        }),
      ];

      const context: RoutingContext = {
        tpmUsage: new Map([
          ['d1', 8000],
          ['d2', 2000],
        ]),
        rpmUsage: new Map([
          ['d1', 80],
          ['d2', 20],
        ]),
      };

      const result = service.selectDeployment(
        deployments,
        RoutingStrategy.LOWEST_TPM_RPM,
        context,
      );
      expect(result.id).toBe('d2');
    });
  });
});
