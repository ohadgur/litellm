import { StreamingService } from '../../../src/streaming/streaming.service';
import { ChatCompletionChunk } from '../../../src/streaming/types';
import { EventEmitter } from 'events';

/** Minimal mock of an Express Response that captures written data. */
function createMockResponse(): {
  res: EventEmitter & {
    setHeader: jest.Mock;
    flushHeaders: jest.Mock;
    write: jest.Mock;
    end: jest.Mock;
    written: string[];
    headers: Record<string, string>;
  };
} {
  const emitter = new EventEmitter();
  const written: string[] = [];
  const headers: Record<string, string> = {};
  const res = Object.assign(emitter, {
    setHeader: jest.fn((k: string, v: string) => {
      headers[k] = v;
    }),
    flushHeaders: jest.fn(),
    write: jest.fn((data: string) => {
      written.push(data);
      return true; // no backpressure
    }),
    end: jest.fn(),
    written,
    headers,
  });
  return { res };
}

function makeChunk(content: string, finish: string | null = null): ChatCompletionChunk {
  return {
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    created: 1700000000,
    model: 'gpt-4o',
    choices: [{ index: 0, delta: { content }, finish_reason: finish }],
  };
}

async function* asyncIterableFrom<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

describe('StreamingService', () => {
  let service: StreamingService;

  beforeEach(() => {
    service = new StreamingService();
  });

  it('converts async iterable to SSE format', async () => {
    const chunks = [makeChunk('Hello'), makeChunk(' world', 'stop')];
    const { res } = createMockResponse();

    await service.streamToSSE(asyncIterableFrom(chunks), res as never);

    expect(res.written).toHaveLength(3); // 2 chunks + [DONE]
    expect(res.written[0]).toBe(`data: ${JSON.stringify(chunks[0])}\n\n`);
    expect(res.written[1]).toBe(`data: ${JSON.stringify(chunks[1])}\n\n`);
  });

  it('sends [DONE] at end', async () => {
    const { res } = createMockResponse();
    await service.streamToSSE(asyncIterableFrom([makeChunk('hi')]), res as never);

    const lastWrite = res.written[res.written.length - 1];
    expect(lastWrite).toBe('data: [DONE]\n\n');
  });

  it('sets correct headers', async () => {
    const { res } = createMockResponse();
    await service.streamToSSE(asyncIterableFrom([]), res as never);

    expect(res.headers['Content-Type']).toBe('text/event-stream');
    expect(res.headers['Cache-Control']).toBe('no-cache');
    expect(res.headers['Connection']).toBe('keep-alive');
    expect(res.flushHeaders).toHaveBeenCalled();
  });

  it('handles empty stream', async () => {
    const { res } = createMockResponse();
    await service.streamToSSE(asyncIterableFrom([]), res as never);

    // Only [DONE] should be written
    expect(res.written).toHaveLength(1);
    expect(res.written[0]).toBe('data: [DONE]\n\n');
    expect(res.end).toHaveBeenCalled();
  });

  it('handles error mid-stream', async () => {
    async function* failingStream(): AsyncIterable<ChatCompletionChunk> {
      yield makeChunk('partial');
      throw new Error('upstream failure');
    }

    const { res } = createMockResponse();
    await service.streamToSSE(failingStream(), res as never);

    // Should have the partial chunk, then an error chunk
    expect(res.written.length).toBeGreaterThanOrEqual(2);
    const errorWrite = res.written[res.written.length - 1];
    const parsed = JSON.parse(errorWrite.replace('data: ', '').trim());
    expect(parsed.error.message).toBe('upstream failure');
    expect(parsed.error.type).toBe('server_error');
    expect(res.end).toHaveBeenCalled();
  });

  it('stops writing when client disconnects', async () => {
    let yieldCount = 0;
    async function* slowStream(): AsyncIterable<ChatCompletionChunk> {
      yield makeChunk('one');
      yieldCount++;
      yield makeChunk('two');
      yieldCount++;
      yield makeChunk('three');
      yieldCount++;
    }

    const { res } = createMockResponse();
    // Simulate disconnect after first write
    res.write.mockImplementation((data: string) => {
      res.written.push(data);
      // Emit close after first chunk written
      if (res.written.length === 1) {
        res.emit('close');
      }
      return true;
    });

    await service.streamToSSE(slowStream(), res as never);

    // The stream should have stopped early; [DONE] should NOT be written
    // because client disconnected
    const hasDone = res.written.some((w: string) => w.includes('[DONE]'));
    expect(hasDone).toBe(false);
  });
});
