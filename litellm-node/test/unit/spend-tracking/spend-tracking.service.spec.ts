import { SpendTrackingService } from '../../../src/spend-tracking/spend-tracking.service';
import { CostCalculatorService } from '../../../src/spend-tracking/cost-calculator.service';
import { SpendBufferService } from '../../../src/spend-tracking/spend-buffer.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { SpendLogParams } from '../../../src/spend-tracking/types/spend-log';

describe('SpendTrackingService', () => {
  let service: SpendTrackingService;
  let costCalculator: CostCalculatorService;
  let spendBuffer: SpendBufferService;
  let prisma: PrismaService;

  let addSpy: jest.SpyInstance;
  let updateMock: jest.Mock;

  const baseParams: SpendLogParams = {
    requestId: 'req-123',
    callType: 'completion',
    apiKeyHash: 'hashed-key-abc',
    model: 'gpt-4o',
    usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
    userId: 'user-1',
    teamId: 'team-1',
    orgId: 'org-1',
    startTime: new Date('2025-01-01T00:00:00Z'),
    endTime: new Date('2025-01-01T00:00:01Z'),
    metadata: { project: 'test' },
  };

  beforeEach(() => {
    updateMock = jest.fn().mockResolvedValue({});
    prisma = {
      liteLLM_SpendLogs: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      liteLLM_VerificationToken: {
        update: updateMock,
      },
    } as unknown as PrismaService;

    costCalculator = new CostCalculatorService();
    spendBuffer = new SpendBufferService(prisma);
    addSpy = jest.spyOn(spendBuffer, 'add');

    service = new SpendTrackingService(prisma, costCalculator, spendBuffer);
  });

  afterEach(async () => {
    await spendBuffer.onModuleDestroy();
  });

  it('logs spend with correct fields', async () => {
    await service.logSpend(baseParams);

    expect(addSpy).toHaveBeenCalledTimes(1);
    const entry = addSpy.mock.calls[0][0];

    expect(entry.request_id).toBe('req-123');
    expect(entry.call_type).toBe('completion');
    expect(entry.api_key).toBe('hashed-key-abc');
    expect(entry.model).toBe('gpt-4o');
    expect(entry.total_tokens).toBe(1500);
    expect(entry.prompt_tokens).toBe(1000);
    expect(entry.completion_tokens).toBe(500);
    expect(entry.user).toBe('user-1');
    expect(entry.team_id).toBe('team-1');
    expect(entry.organization_id).toBe('org-1');
    expect(entry.metadata).toEqual({ project: 'test' });

    // Cost should be calculated: 1000 * 0.0000025 + 500 * 0.00001 = 0.0075
    expect(entry.spend).toBeCloseTo(0.0075, 8);
  });

  it('fires updateKeySpend when cost > 0', async () => {
    await service.logSpend(baseParams);

    // Give the void promise a tick to resolve
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(updateMock).toHaveBeenCalledWith({
      where: { token: 'hashed-key-abc' },
      data: { spend: { increment: expect.closeTo(0.0075, 6) } },
    });
  });

  it('does not update key spend when cost is 0', async () => {
    await service.logSpend({
      ...baseParams,
      model: 'unknown-model',
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(updateMock).not.toHaveBeenCalled();
  });

  it('updates key spend directly', async () => {
    await service.updateKeySpend('hashed-key-xyz', 0.05);

    expect(updateMock).toHaveBeenCalledWith({
      where: { token: 'hashed-key-xyz' },
      data: { spend: { increment: 0.05 } },
    });
  });

  it('handles updateKeySpend DB errors gracefully', async () => {
    updateMock.mockRejectedValueOnce(new Error('DB error'));

    // Should not throw
    await expect(service.updateKeySpend('key', 0.01)).resolves.toBeUndefined();
  });

  it('handles logSpend errors gracefully', async () => {
    jest.spyOn(costCalculator, 'calculateCost').mockImplementation(() => {
      throw new Error('calculation error');
    });

    // Should not throw
    await expect(service.logSpend(baseParams)).resolves.toBeUndefined();
  });
});
