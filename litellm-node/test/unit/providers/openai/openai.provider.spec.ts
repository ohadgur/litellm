import { OpenAIProvider } from '../../../../src/providers/openai/openai.provider';
import {
  Deployment,
  ProviderRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from '../../../../src/shared/types';
import { ProviderError, ProviderErrorType } from '../../../../src/shared/types/errors';

/** Testable subclass that exposes doFetch for mocking */
class TestableOpenAIProvider extends OpenAIProvider {
  public mockFetch = jest.fn<Promise<Response>, [string, RequestInit]>();

  protected doFetch(url: string, init: RequestInit): Promise<Response> {
    return this.mockFetch(url, init);
  }
}

const makeDeployment = (overrides: Partial<Deployment> = {}): Deployment => ({
  modelName: 'gpt-4',
  apiKey: 'sk-test-key',
  provider: 'openai',
  ...overrides,
});

const makeRequest = (overrides: Partial<ProviderRequest> = {}): ProviderRequest => ({
  deployment: makeDeployment(),
  body: {
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Hello' }],
  },
  ...overrides,
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

const SAMPLE_COMPLETION: ChatCompletionResponse = {
  id: 'chatcmpl-abc',
  object: 'chat.completion',
  created: 1700000000,
  model: 'gpt-4',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'Hi there!' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
};

describe('OpenAIProvider', () => {
  let provider: TestableOpenAIProvider;

  beforeEach(() => {
    provider = new TestableOpenAIProvider();
  });

  describe('chatCompletion', () => {
    it('sends correct Authorization header', async () => {
      provider.mockFetch.mockResolvedValue(jsonResponse(SAMPLE_COMPLETION));

      await provider.chatCompletion(makeRequest());

      const [, init] = provider.mockFetch.mock.calls[0];
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer sk-test-key');
    });

    it('sends Organization header when set', async () => {
      provider.mockFetch.mockResolvedValue(jsonResponse(SAMPLE_COMPLETION));

      await provider.chatCompletion(
        makeRequest({
          deployment: makeDeployment({ organizationId: 'org-123' }),
        }),
      );

      const [, init] = provider.mockFetch.mock.calls[0];
      const headers = init.headers as Record<string, string>;
      expect(headers['OpenAI-Organization']).toBe('org-123');
    });

    it('passes deployment model name in request body', async () => {
      provider.mockFetch.mockResolvedValue(jsonResponse(SAMPLE_COMPLETION));

      await provider.chatCompletion(
        makeRequest({
          deployment: makeDeployment({ modelName: 'gpt-4-turbo' }),
        }),
      );

      const [, init] = provider.mockFetch.mock.calls[0];
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('gpt-4-turbo');
    });

    it('calls the correct URL', async () => {
      provider.mockFetch.mockResolvedValue(jsonResponse(SAMPLE_COMPLETION));

      await provider.chatCompletion(makeRequest());

      const [url] = provider.mockFetch.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
    });

    it('uses custom apiBase when provided', async () => {
      provider.mockFetch.mockResolvedValue(jsonResponse(SAMPLE_COMPLETION));

      await provider.chatCompletion(
        makeRequest({
          deployment: makeDeployment({
            apiBase: 'https://custom.openai.azure.com/v1',
          }),
        }),
      );

      const [url] = provider.mockFetch.mock.calls[0];
      expect(url).toBe(
        'https://custom.openai.azure.com/v1/chat/completions',
      );
    });

    it('returns parsed response', async () => {
      provider.mockFetch.mockResolvedValue(jsonResponse(SAMPLE_COMPLETION));

      const result = await provider.chatCompletion(makeRequest());

      expect(result).toEqual(SAMPLE_COMPLETION);
    });

    it('sets stream to false', async () => {
      provider.mockFetch.mockResolvedValue(jsonResponse(SAMPLE_COMPLETION));

      await provider.chatCompletion(makeRequest());

      const [, init] = provider.mockFetch.mock.calls[0];
      const body = JSON.parse(init.body as string);
      expect(body.stream).toBe(false);
    });

    it('merges extra headers from request', async () => {
      provider.mockFetch.mockResolvedValue(jsonResponse(SAMPLE_COMPLETION));

      await provider.chatCompletion(
        makeRequest({ headers: { 'X-Custom': 'value' } }),
      );

      const [, init] = provider.mockFetch.mock.calls[0];
      const headers = init.headers as Record<string, string>;
      expect(headers['X-Custom']).toBe('value');
    });
  });

  describe('chatCompletion error handling', () => {
    it('maps 401 to AuthenticationError', async () => {
      provider.mockFetch.mockResolvedValue(
        jsonResponse(
          { error: { message: 'Invalid API key', type: 'invalid_api_key' } },
          401,
        ),
      );

      try {
        await provider.chatCompletion(makeRequest());
        fail('Expected ProviderError to be thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        const err = e as ProviderError;
        expect(err.statusCode).toBe(401);
        expect(err.errorType).toBe(ProviderErrorType.AuthenticationError);
        expect(err.message).toBe('Invalid API key');
      }
    });

    it('maps 429 to RateLimitError', async () => {
      provider.mockFetch.mockResolvedValue(
        jsonResponse({ error: { message: 'Rate limit exceeded' } }, 429),
      );

      await expect(provider.chatCompletion(makeRequest())).rejects.toMatchObject({
        statusCode: 429,
        errorType: ProviderErrorType.RateLimitError,
      });
    });

    it('maps 400 to InvalidRequestError', async () => {
      provider.mockFetch.mockResolvedValue(
        jsonResponse({ error: { message: 'Invalid model' } }, 400),
      );

      await expect(provider.chatCompletion(makeRequest())).rejects.toMatchObject({
        statusCode: 400,
        errorType: ProviderErrorType.InvalidRequestError,
      });
    });

    it('maps 404 to NotFoundError', async () => {
      provider.mockFetch.mockResolvedValue(
        jsonResponse({ error: { message: 'Model not found' } }, 404),
      );

      await expect(provider.chatCompletion(makeRequest())).rejects.toMatchObject({
        errorType: ProviderErrorType.NotFoundError,
      });
    });

    it('maps 500 to ServerError', async () => {
      provider.mockFetch.mockResolvedValue(
        jsonResponse({ error: { message: 'Internal error' } }, 500),
      );

      await expect(provider.chatCompletion(makeRequest())).rejects.toMatchObject({
        errorType: ProviderErrorType.ServerError,
      });
    });

    it('maps unknown status to Unknown error', async () => {
      provider.mockFetch.mockResolvedValue(
        jsonResponse({ error: { message: 'Weird error' } }, 418),
      );

      await expect(provider.chatCompletion(makeRequest())).rejects.toMatchObject({
        errorType: ProviderErrorType.Unknown,
      });
    });
  });

  describe('chatCompletionStream', () => {
    it('yields parsed chunks from SSE', async () => {
      const chunk1: ChatCompletionChunk = {
        id: 'chatcmpl-abc',
        object: 'chat.completion.chunk',
        created: 1700000000,
        model: 'gpt-4',
        choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
      };
      const chunk2: ChatCompletionChunk = {
        id: 'chatcmpl-abc',
        object: 'chat.completion.chunk',
        created: 1700000000,
        model: 'gpt-4',
        choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: null }],
      };

      const sseData = [
        `data: ${JSON.stringify(chunk1)}\n\n`,
        `data: ${JSON.stringify(chunk2)}\n\n`,
        `data: [DONE]\n\n`,
      ].join('');

      provider.mockFetch.mockResolvedValue(sseResponse([sseData]));

      const collected: ChatCompletionChunk[] = [];
      for await (const c of provider.chatCompletionStream(makeRequest())) {
        collected.push(c);
      }

      expect(collected).toHaveLength(2);
      expect(collected[0]).toEqual(chunk1);
      expect(collected[1]).toEqual(chunk2);
    });

    it('handles chunks split across multiple reads', async () => {
      const chunk: ChatCompletionChunk = {
        id: 'chatcmpl-abc',
        object: 'chat.completion.chunk',
        created: 1700000000,
        model: 'gpt-4',
        choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
      };
      const json = JSON.stringify(chunk);
      // Split the data mid-line
      const part1 = `data: ${json.slice(0, 10)}`;
      const part2 = `${json.slice(10)}\n\ndata: [DONE]\n\n`;

      provider.mockFetch.mockResolvedValue(sseResponse([part1, part2]));

      const collected: ChatCompletionChunk[] = [];
      for await (const c of provider.chatCompletionStream(makeRequest())) {
        collected.push(c);
      }

      expect(collected).toHaveLength(1);
      expect(collected[0]).toEqual(chunk);
    });

    it('sets stream to true in request', async () => {
      provider.mockFetch.mockResolvedValue(
        sseResponse(['data: [DONE]\n\n']),
      );

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of provider.chatCompletionStream(makeRequest())) {
        // drain
      }

      const [, init] = provider.mockFetch.mock.calls[0];
      const body = JSON.parse(init.body as string);
      expect(body.stream).toBe(true);
    });

    it('throws on error response', async () => {
      provider.mockFetch.mockResolvedValue(
        jsonResponse({ error: { message: 'Bad request' } }, 400),
      );

      const iter = provider.chatCompletionStream(makeRequest());
      await expect(
        (async () => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          for await (const _ of iter) {
            // drain
          }
        })(),
      ).rejects.toThrow(ProviderError);
    });

    it('skips comment lines', async () => {
      const chunk: ChatCompletionChunk = {
        id: 'chatcmpl-abc',
        object: 'chat.completion.chunk',
        created: 1700000000,
        model: 'gpt-4',
        choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: null }],
      };

      const sseData = [
        `: this is a comment\n`,
        `data: ${JSON.stringify(chunk)}\n\n`,
        `data: [DONE]\n\n`,
      ].join('');

      provider.mockFetch.mockResolvedValue(sseResponse([sseData]));

      const collected: ChatCompletionChunk[] = [];
      for await (const c of provider.chatCompletionStream(makeRequest())) {
        collected.push(c);
      }

      expect(collected).toHaveLength(1);
    });
  });

  describe('embedding', () => {
    it('calls embeddings endpoint', async () => {
      const embeddingResponse = {
        object: 'list',
        data: [{ object: 'embedding', embedding: [0.1, 0.2], index: 0 }],
        model: 'text-embedding-ada-002',
        usage: { prompt_tokens: 5, total_tokens: 5 },
      };
      provider.mockFetch.mockResolvedValue(jsonResponse(embeddingResponse));

      const result = await provider.embedding({
        deployment: makeDeployment({ modelName: 'text-embedding-ada-002' }),
        model: 'text-embedding-ada-002',
        input: 'Hello world',
      });

      const [url] = provider.mockFetch.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/embeddings');
      expect(result).toEqual(embeddingResponse);
    });
  });

  describe('listModels', () => {
    it('calls models endpoint and returns data array', async () => {
      const modelsResponse = {
        data: [
          { id: 'gpt-4', object: 'model', created: 1700000000, owned_by: 'openai' },
          { id: 'gpt-3.5-turbo', object: 'model', created: 1700000000, owned_by: 'openai' },
        ],
      };
      provider.mockFetch.mockResolvedValue(jsonResponse(modelsResponse));

      const result = await provider.listModels(makeDeployment());

      const [url] = provider.mockFetch.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/models');
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('gpt-4');
    });
  });
});
