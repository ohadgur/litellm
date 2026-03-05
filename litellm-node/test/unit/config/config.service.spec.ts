import * as path from 'path';
import { ConfigService } from '../../../src/config/config.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { RoutingStrategy } from '../../../src/shared/types/routing';

const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures');
const TEST_CONFIG_PATH = path.join(FIXTURES_DIR, 'test-config.yaml');

describe('ConfigService', () => {
  let service: ConfigService;
  let prisma: PrismaService;

  beforeEach(async () => {
    // Point to test fixture
    process.env['LITELLM_CONFIG_PATH'] = TEST_CONFIG_PATH;
    // Set env vars referenced in the fixture
    process.env['OPENAI_API_KEY'] = 'sk-openai-test';
    process.env['AZURE_KEY'] = 'az-key-test';
    process.env['ANTHROPIC_API_KEY'] = 'sk-anthropic-test';

    prisma = new PrismaService();
    service = new ConfigService(prisma);
    await service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
    delete process.env['LITELLM_CONFIG_PATH'];
    delete process.env['OPENAI_API_KEY'];
    delete process.env['AZURE_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
  });

  // ── YAML parsing ─────────────────────────────────────────────────

  it('loads deployments from YAML', () => {
    const all = service.getAllDeployments();
    expect(all.length).toBe(4);
  });

  it('substitutes os.environ env vars', () => {
    const [openaiDeploy] = service.getDeployments('gpt-4o');
    expect(openaiDeploy.litellmParams['api_key']).toBe('sk-openai-test');
  });

  it('substitutes ${VAR} env vars', () => {
    const deployments = service.getDeployments('gpt-4o');
    const azureDeploy = deployments.find((d) => d.provider === 'azure');
    expect(azureDeploy).toBeDefined();
    expect(azureDeploy!.litellmParams['api_key']).toBe('az-key-test');
  });

  // ── getDeployments ───────────────────────────────────────────────

  it('returns correct deployments for a model name', () => {
    const gpt4o = service.getDeployments('gpt-4o');
    expect(gpt4o).toHaveLength(2);
    expect(gpt4o.map((d) => d.provider).sort()).toEqual(['azure', 'openai']);
  });

  it('returns empty array for unknown model name', () => {
    expect(service.getDeployments('nonexistent')).toEqual([]);
  });

  // ── getAllModelNames ─────────────────────────────────────────────

  it('lists unique model names', () => {
    const names = service.getAllModelNames();
    expect(names.sort()).toEqual(['bedrock-claude', 'claude-3', 'gpt-4o']);
  });

  // ── Provider extraction ──────────────────────────────────────────

  it('extracts openai provider from model string', () => {
    const [d] = service.getDeployments('gpt-4o');
    expect(d.provider).toBe('openai');
    expect(d.model).toBe('gpt-4o');
  });

  it('extracts anthropic provider', () => {
    const [d] = service.getDeployments('claude-3');
    expect(d.provider).toBe('anthropic');
    expect(d.model).toBe('claude-sonnet-4-20250514');
  });

  it('extracts bedrock provider with complex model id', () => {
    const [d] = service.getDeployments('bedrock-claude');
    expect(d.provider).toBe('bedrock');
    expect(d.model).toBe('us.anthropic.claude-3-5-sonnet-20240620-v1:0');
  });

  it('extracts azure provider', () => {
    const deployments = service.getDeployments('gpt-4o');
    const azure = deployments.find((d) => d.provider === 'azure');
    expect(azure).toBeDefined();
    expect(azure!.model).toBe('gpt-4o-deployment');
  });

  // ── Routing strategy ─────────────────────────────────────────────

  it('reads routing strategy from config', () => {
    expect(service.getRoutingStrategy()).toBe(RoutingStrategy.SimpleShuffle);
  });

  // ── Fallbacks ────────────────────────────────────────────────────

  it('returns fallbacks for a model', () => {
    const fb = service.getFallbacks('gpt-4o');
    expect(fb).toEqual(['claude-3', 'bedrock-claude']);
  });

  it('returns empty fallbacks for model without fallbacks', () => {
    expect(service.getFallbacks('claude-3')).toEqual([]);
  });

  // ── DB integration ───────────────────────────────────────────────

  it('merges deployments from database', async () => {
    jest.spyOn(prisma, 'getProxyModelTableEntries').mockResolvedValue([
      {
        model_name: 'db-model',
        litellm_params: { model: 'openai/gpt-4o-mini' },
      },
    ]);

    await service.loadConfig();
    const names = service.getAllModelNames();
    expect(names).toContain('db-model');
    expect(service.getDeployments('db-model')).toHaveLength(1);
  });

  it('handles database errors gracefully', async () => {
    jest.spyOn(prisma, 'getProxyModelTableEntries').mockRejectedValue(new Error('DB down'));
    await service.loadConfig();
    // Should still have YAML deployments
    expect(service.getAllDeployments().length).toBeGreaterThan(0);
  });

  // ── Missing config file ──────────────────────────────────────────

  it('handles missing config file gracefully', async () => {
    process.env['LITELLM_CONFIG_PATH'] = '/tmp/nonexistent-config-12345.yaml';
    const svc = new ConfigService(prisma);
    await svc.onModuleInit();
    expect(svc.getAllDeployments()).toEqual([]);
    svc.onModuleDestroy();
  });
});
