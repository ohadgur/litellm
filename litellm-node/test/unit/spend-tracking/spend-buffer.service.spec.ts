import { SpendBufferService } from '../../../src/spend-tracking/spend-buffer.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { SpendLogEntry } from '../../../src/spend-tracking/types/spend-log';

function makeEntry(overrides: Partial<SpendLogEntry> = {}): SpendLogEntry {
  return {
    request_id: `req-${Math.random().toString(36).slice(2)}`,
    call_type: 'completion',
    api_key: 'hashed-key',
    spend: 0.01,
    total_tokens: 100,
    prompt_tokens: 80,
    completion_tokens: 20,
    model: 'gpt-4o',
    startTime: new Date(),
    endTime: new Date(),
    ...overrides,
  };
}

describe('SpendBufferService', () => {
  let service: SpendBufferService;
  let prisma: PrismaService;
  let createManyMock: jest.Mock;

  beforeEach(() => {
    createManyMock = jest.fn().mockResolvedValue({ count: 0 });
    prisma = {
      liteLLM_SpendLogs: {
        createMany: createManyMock,
      },
    } as unknown as PrismaService;

    service = new SpendBufferService(prisma);
  });

  afterEach(async () => {
    // Clean up the interval timer
    await service.onModuleDestroy();
  });

  it('buffers entries without flushing under threshold', () => {
    service.add(makeEntry());
    expect(service.bufferSize).toBe(1);
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it('flushes when buffer reaches threshold (100)', () => {
    for (let i = 0; i < 100; i++) {
      service.add(makeEntry());
    }

    // Flush is called via void (fire-and-forget), give it a tick
    expect(service.bufferSize).toBe(0);
  });

  it('flushes on timer', async () => {
    jest.useFakeTimers();

    // Re-create the service with fake timers active
    await service.onModuleDestroy();
    service = new SpendBufferService(prisma);

    service.add(makeEntry());
    expect(service.bufferSize).toBe(1);

    jest.advanceTimersByTime(5000);

    // Let the async flush resolve
    await Promise.resolve();

    expect(createManyMock).toHaveBeenCalledTimes(1);
    expect(createManyMock).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ call_type: 'completion' }),
      ]),
    });

    await service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('flushes remaining entries on destroy', async () => {
    service.add(makeEntry());
    service.add(makeEntry());

    expect(service.bufferSize).toBe(2);

    await service.onModuleDestroy();

    expect(createManyMock).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ call_type: 'completion' }),
      ]),
    });
    expect(service.bufferSize).toBe(0);
  });

  it('handles DB errors gracefully', async () => {
    createManyMock.mockRejectedValueOnce(new Error('DB connection lost'));

    service.add(makeEntry());
    await service.flush();

    // Buffer is cleared even on error (entries discarded)
    expect(service.bufferSize).toBe(0);
  });

  it('skips flush when buffer is empty', async () => {
    await service.flush();
    expect(createManyMock).not.toHaveBeenCalled();
  });
});
