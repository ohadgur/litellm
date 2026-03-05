import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { AuthService, PrismaDelegate } from '../../../src/auth/auth.service';
import { createHash } from 'crypto';

function hash(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    token: hash('sk-valid-key'),
    key_name: 'test-key',
    key_alias: null,
    spend: 5.0,
    max_budget: 100.0,
    expires: null,
    models: [],
    user_id: 'user-1',
    team_id: 'team-1',
    organization_id: 'org-1',
    permissions: {},
    max_parallel_requests: null,
    metadata: {},
    tpm_limit: null,
    rpm_limit: null,
    blocked: false,
    ...overrides,
  };
}

function makePrisma(row: ReturnType<typeof makeRow> | null = makeRow()): PrismaDelegate {
  return {
    liteLLM_VerificationToken: {
      findUnique: jest.fn().mockResolvedValue(row),
    },
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let prisma: PrismaDelegate;

  beforeEach(() => {
    prisma = makePrisma();
    service = new AuthService(prisma);
  });

  it('should return UserAPIKeyAuth for a valid key', async () => {
    const result = await service.validateApiKey('sk-valid-key');

    expect(result.token).toBe(hash('sk-valid-key'));
    expect(result.keyName).toBe('test-key');
    expect(result.userId).toBe('user-1');
    expect(result.teamId).toBe('team-1');
    expect(result.orgId).toBe('org-1');
    expect(result.spend).toBe(5.0);
    expect(result.maxBudget).toBe(100.0);
    expect(result.models).toEqual([]);
  });

  it('should throw 401 for an unknown key', async () => {
    prisma = makePrisma(null);
    service = new AuthService(prisma);

    await expect(service.validateApiKey('sk-unknown')).rejects.toThrow(UnauthorizedException);
  });

  it('should throw 401 for an expired key', async () => {
    const pastDate = new Date(Date.now() - 86_400_000); // yesterday
    prisma = makePrisma(makeRow({ expires: pastDate }));
    service = new AuthService(prisma);

    await expect(service.validateApiKey('sk-valid-key')).rejects.toThrow(UnauthorizedException);
  });

  it('should throw 401 for a blocked key', async () => {
    prisma = makePrisma(makeRow({ blocked: true }));
    service = new AuthService(prisma);

    await expect(service.validateApiKey('sk-valid-key')).rejects.toThrow(UnauthorizedException);
  });

  it('should throw 403 when budget is exceeded', async () => {
    prisma = makePrisma(makeRow({ spend: 100, max_budget: 100 }));
    service = new AuthService(prisma);

    await expect(service.validateApiKey('sk-valid-key')).rejects.toThrow(ForbiddenException);
  });

  it('should throw 403 when requested model is not allowed', async () => {
    prisma = makePrisma(makeRow({ models: ['gpt-4', 'gpt-3.5-turbo'] }));
    service = new AuthService(prisma);

    await expect(service.validateApiKey('sk-valid-key', 'claude-3')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('should allow any model when models array is empty', async () => {
    prisma = makePrisma(makeRow({ models: [] }));
    service = new AuthService(prisma);

    const result = await service.validateApiKey('sk-valid-key', 'any-model');
    expect(result.token).toBe(hash('sk-valid-key'));
  });

  it('should allow a listed model', async () => {
    prisma = makePrisma(makeRow({ models: ['gpt-4'] }));
    service = new AuthService(prisma);

    const result = await service.validateApiKey('sk-valid-key', 'gpt-4');
    expect(result.token).toBe(hash('sk-valid-key'));
  });

  it('should serve from cache on second call without hitting DB again', async () => {
    const findUnique = prisma.liteLLM_VerificationToken.findUnique as jest.Mock;

    await service.validateApiKey('sk-valid-key');
    expect(findUnique).toHaveBeenCalledTimes(1);

    await service.validateApiKey('sk-valid-key');
    expect(findUnique).toHaveBeenCalledTimes(1); // still 1 — cache hit
  });

  it('should allow null max_budget (unlimited)', async () => {
    prisma = makePrisma(makeRow({ max_budget: null, spend: 999_999 }));
    service = new AuthService(prisma);

    const result = await service.validateApiKey('sk-valid-key');
    expect(result.spend).toBe(999_999);
    expect(result.maxBudget).toBeUndefined();
  });

  it('should convert bigint tpm/rpm limits to numbers', async () => {
    prisma = makePrisma(makeRow({ tpm_limit: BigInt(1000), rpm_limit: BigInt(60) }));
    service = new AuthService(prisma);

    const result = await service.validateApiKey('sk-valid-key');
    expect(result.tpmLimit).toBe(1000);
    expect(result.rpmLimit).toBe(60);
  });
});
