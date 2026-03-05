import { CooldownService } from '../../../src/router/cooldown.service';
import { Deployment } from '../../../src/router/types/routing';

function makeDeployment(id: string): Deployment {
  return {
    id,
    modelName: 'gpt-4',
    litellmParams: { model: 'gpt-4' },
    modelInfo: { id },
  };
}

describe('CooldownService', () => {
  let service: CooldownService;

  beforeEach(() => {
    service = new CooldownService(1_000); // 1 second cooldown for tests
  });

  it('should treat unknown deployments as available', () => {
    expect(service.isAvailable('unknown-id')).toBe(true);
  });

  it('should mark a failed deployment as unavailable', () => {
    service.markFailed('deploy-1', new Error('rate limited'));
    expect(service.isAvailable('deploy-1')).toBe(false);
  });

  it('should expire cooldown after duration', async () => {
    service = new CooldownService(50); // 50ms cooldown
    service.markFailed('deploy-1', new Error('timeout'));
    expect(service.isAvailable('deploy-1')).toBe(false);

    await new Promise((r) => setTimeout(r, 60));
    expect(service.isAvailable('deploy-1')).toBe(true);
  });

  it('should track failure counts within the window', () => {
    service.markFailed('deploy-1', new Error('error 1'));
    service.markFailed('deploy-1', new Error('error 2'));
    service.markFailed('deploy-1', new Error('error 3'));

    const health = service.getHealth('deploy-1');
    expect(health).toBeDefined();
    expect(health!.failureCount).toBe(3);
  });

  it('should filter out cooled-down deployments from a list', () => {
    const deployments = [
      makeDeployment('d1'),
      makeDeployment('d2'),
      makeDeployment('d3'),
    ];

    service.markFailed('d2', new Error('failed'));

    const healthy = service.getHealthyDeployments(deployments);
    expect(healthy).toHaveLength(2);
    expect(healthy.map((d) => d.id)).toEqual(['d1', 'd3']);
  });

  it('should return all deployments when none are cooled down', () => {
    const deployments = [makeDeployment('d1'), makeDeployment('d2')];
    const healthy = service.getHealthyDeployments(deployments);
    expect(healthy).toHaveLength(2);
  });

  it('should clear state', () => {
    service.markFailed('d1', new Error('fail'));
    expect(service.isAvailable('d1')).toBe(false);

    service.clear();
    expect(service.isAvailable('d1')).toBe(true);
  });
});
