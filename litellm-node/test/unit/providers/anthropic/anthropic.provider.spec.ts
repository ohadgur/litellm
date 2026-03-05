import { AnthropicProvider } from '../../../../src/providers/anthropic/anthropic.provider';
import {
  ChatCompletionRequest,
  Deployment,
} from '../../../../src/providers/types/llm-provider.interface';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeployment(overrides: Partial<Deployment['litellmParams']> = {}): Deployment {
  return {
    litellmParams: {
      model: 'anthropic/claude-sonnet-4-20250514',
      api_key: 'sk-test-key',
      ...overrides,
    },
  };
}

function makeRequest(overrides: Partial<ChatCompletionRequest> = {}): ChatCompletionRequest {
  return {
    model: 'anthropic/claude-sonnet-4-20250514',
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    provider = new AnthropicProvider();
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // chatCompletion
  // -----------------------------------------------------------------------

  describe('chatCompletion', () => {
    it('should send correct headers', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'Hi' }],
            model: 'claude-sonnet-4-20250514',
            stop_reason: 'end_turn',
            usage: { input_tokens: 5, output_tokens: 2 },
          }),
          { status: 200 },
        ),
      );

      await provider.chatCompletion(makeRequest(), makeDeployment());

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect(init.headers['x-api-key']).toBe('sk-test-key');
      expect(init.headers['anthropic-version']).toBe('2023-06-01');
      expect(init.headers['content-type']).toBe('application/json');
    });

    it('should strip anthropic/ prefix from model name', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'msg_2',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'Hi' }],
            model: 'claude-sonnet-4-20250514',
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200 },
        ),
      );

      await provider.chatCompletion(makeRequest(), makeDeployment());

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.model).toBe('claude-sonnet-4-20250514');
    });

    it('should use custom api_base when provided', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'msg_3',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'Hi' }],
            model: 'claude-sonnet-4-20250514',
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200 },
        ),
      );

      await provider.chatCompletion(
        makeRequest(),
        makeDeployment({ api_base: 'https://custom.proxy.com' }),
      );

      expect(fetchSpy.mock.calls[0][0]).toBe('https://custom.proxy.com/v1/messages');
    });

    it('should throw on API error', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('{"error":{"message":"bad request"}}', { status: 400 }),
      );

      await expect(provider.chatCompletion(makeRequest(), makeDeployment())).rejects.toThrow(
        /Anthropic API error 400/,
      );
    });

    it('should not include stream in non-streaming request body', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'msg_4',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'ok' }],
            model: 'claude-sonnet-4-20250514',
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200 },
        ),
      );

      await provider.chatCompletion(
        makeRequest({ stream: true }), // even if set, non-streaming path removes it
        makeDeployment(),
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.stream).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // chatCompletionStream
  // -----------------------------------------------------------------------

  describe('chatCompletionStream', () => {
    it('should send stream=true in the request body', async () => {
      // Create a minimal readable stream that ends immediately
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_s","model":"claude-sonnet-4-20250514","usage":{"input_tokens":1,"output_tokens":0}}}\n\n' +
              'event: message_stop\ndata: {"type":"message_stop"}\n\n',
            ),
          );
          controller.close();
        },
      });

      fetchSpy.mockResolvedValueOnce(new Response(stream, { status: 200 }));

      const chunks: unknown[] = [];
      for await (const chunk of provider.chatCompletionStream(makeRequest(), makeDeployment())) {
        chunks.push(chunk);
      }

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.stream).toBe(true);
    });

    it('should throw on API error', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('server error', { status: 500 }),
      );

      const iterable = provider.chatCompletionStream(makeRequest(), makeDeployment());
      const iterator = iterable[Symbol.asyncIterator]();
      await expect(iterator.next()).rejects.toThrow(/Anthropic API error 500/);
    });
  });
});
