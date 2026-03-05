import { normalizeStreamChunk, UsageAccumulator } from '../../../src/streaming/stream-transformer';

describe('normalizeStreamChunk', () => {
  it('normalizes OpenAI-format chunks (passthrough)', () => {
    const raw = {
      id: 'chatcmpl-abc',
      object: 'chat.completion.chunk',
      created: 1694268190,
      model: 'gpt-4o',
      choices: [
        { index: 0, delta: { content: 'Hello' }, finish_reason: null },
      ],
    };

    const result = normalizeStreamChunk(raw, 'openai');

    expect(result.id).toBe('chatcmpl-abc');
    expect(result.object).toBe('chat.completion.chunk');
    expect(result.created).toBe(1694268190);
    expect(result.model).toBe('gpt-4o');
    expect(result.choices).toHaveLength(1);
    expect(result.choices[0].delta).toEqual({ content: 'Hello' });
    expect(result.choices[0].finish_reason).toBeNull();
    expect(result.usage).toBeNull();
  });

  it('handles chunks with usage', () => {
    const raw = {
      id: 'chatcmpl-abc',
      object: 'chat.completion.chunk',
      created: 1694268190,
      model: 'gpt-4o',
      choices: [
        { index: 0, delta: {}, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 9, completion_tokens: 12, total_tokens: 21 },
    };

    const result = normalizeStreamChunk(raw, 'openai');

    expect(result.usage).toEqual({
      prompt_tokens: 9,
      completion_tokens: 12,
      total_tokens: 21,
    });
  });

  it('handles chunks without usage', () => {
    const raw = {
      id: 'chatcmpl-abc',
      created: 1694268190,
      model: 'gpt-4o',
      choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
    };

    const result = normalizeStreamChunk(raw, 'openai');

    expect(result.usage).toBeNull();
  });

  it('fills in defaults for missing fields', () => {
    const raw = {};

    const result = normalizeStreamChunk(raw, 'unknown');

    expect(result.id).toMatch(/^chatcmpl-/);
    expect(result.object).toBe('chat.completion.chunk');
    expect(result.created).toBeGreaterThan(0);
    expect(result.model).toBe('unknown');
    expect(result.choices).toEqual([]);
    expect(result.usage).toBeNull();
  });
});

describe('UsageAccumulator', () => {
  it('returns null when no usage accumulated', () => {
    const acc = new UsageAccumulator();
    expect(acc.getTotal()).toBeNull();
  });

  it('accumulates usage taking max values', () => {
    const acc = new UsageAccumulator();
    acc.accumulate({ prompt_tokens: 9, completion_tokens: 5, total_tokens: 14 });
    acc.accumulate({ prompt_tokens: 9, completion_tokens: 12, total_tokens: 21 });

    expect(acc.getTotal()).toEqual({
      prompt_tokens: 9,
      completion_tokens: 12,
      total_tokens: 21,
    });
  });

  it('ignores null/undefined usage', () => {
    const acc = new UsageAccumulator();
    acc.accumulate(null);
    acc.accumulate(undefined);
    expect(acc.getTotal()).toBeNull();
  });
});
