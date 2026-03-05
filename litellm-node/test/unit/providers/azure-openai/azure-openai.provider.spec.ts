import { AzureOpenAIProvider } from '../../../../src/providers/azure-openai/azure-openai.provider';
import { ProviderError } from '../../../../src/shared/types/errors';
import {
  ChatCompletionRequest,
  Deployment,
  ProviderRequest,
} from '../../../../src/shared/types';

/**
 * Testable subclass that intercepts fetch calls.
 */
class TestableAzureProvider extends AzureOpenAIProvider {
  public lastFetchUrl = '';
  public lastFetchInit: RequestInit = {};
  private mockResponse: Response = new Response();

  setMockResponse(response: Response): void {
    this.mockResponse = response;
  }

  protected override doFetch(url: string, init: RequestInit): Promise<Response> {
    this.lastFetchUrl = url;
    this.lastFetchInit = init;
    return Promise.resolve(this.mockResponse);
  }
}

const makeDeployment = (overrides: Partial<Deployment> = {}): Deployment => ({
  modelName: 'my-gpt4-deployment',
  apiKey: 'abc123',
  apiBase: 'https://my-resource.openai.azure.com',
  provider: 'azure',
  ...overrides,
});

const makeRequest = (overrides: Partial<ProviderRequest> = {}): ProviderRequest => ({
  deployment: makeDeployment(),
  body: {
    model: 'azure/my-gpt4-deployment',
    messages: [{ role: 'user', content: 'Hello' }],
  },
  ...overrides,
});

describe('AzureOpenAIProvider', () => {
  let provider: TestableAzureProvider;

  beforeEach(() => {
    provider = new TestableAzureProvider();
  });

  describe('chatCompletion', () => {
    it('calls the correct Azure URL', async () => {
      const responseBody = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
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
      provider.setMockResponse(
        new Response(JSON.stringify(responseBody), { status: 200 }),
      );

      await provider.chatCompletion(makeRequest());

      expect(provider.lastFetchUrl).toBe(
        'https://my-resource.openai.azure.com/openai/deployments/my-gpt4-deployment/chat/completions?api-version=2024-06-01',
      );
    });

    it('sends api-key header instead of Authorization Bearer', async () => {
      const responseBody = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
      provider.setMockResponse(
        new Response(JSON.stringify(responseBody), { status: 200 }),
      );

      await provider.chatCompletion(makeRequest());

      const headers = provider.lastFetchInit.headers as Record<string, string>;
      expect(headers['api-key']).toBe('abc123');
      expect(headers['Authorization']).toBeUndefined();
    });

    it('does not include model in request body', async () => {
      const responseBody = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
      provider.setMockResponse(
        new Response(JSON.stringify(responseBody), { status: 200 }),
      );

      await provider.chatCompletion(makeRequest());

      const sentBody = JSON.parse(provider.lastFetchInit.body as string);
      expect(sentBody.model).toBeUndefined();
      expect(sentBody.messages).toBeDefined();
    });

    it('overrides model in response to match user alias', async () => {
      const responseBody = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hi' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
      };
      provider.setMockResponse(
        new Response(JSON.stringify(responseBody), { status: 200 }),
      );

      const result = await provider.chatCompletion(makeRequest());

      expect(result.model).toBe('azure/my-gpt4-deployment');
    });

    it('throws ProviderError on 401', async () => {
      provider.setMockResponse(
        new Response(
          JSON.stringify({ error: { message: 'Invalid API key' } }),
          { status: 401 },
        ),
      );

      await expect(provider.chatCompletion(makeRequest())).rejects.toThrow(
        ProviderError,
      );
    });

    it('throws ProviderError on 429 rate limit', async () => {
      provider.setMockResponse(
        new Response(
          JSON.stringify({ error: { message: 'Rate limit exceeded' } }),
          { status: 429 },
        ),
      );

      try {
        await provider.chatCompletion(makeRequest());
        fail('Expected error');
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderError);
        expect((err as ProviderError).statusCode).toBe(429);
        expect((err as ProviderError).errorType).toBe('rate_limit_error');
      }
    });
  });

  describe('chatCompletionStream', () => {
    it('calls the correct Azure URL with stream=true', async () => {
      const sseData = [
        'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant","content":"Hi"},"finish_reason":null}]}\n',
        'data: [DONE]\n',
      ].join('\n');

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseData));
          controller.close();
        },
      });

      provider.setMockResponse(new Response(stream, { status: 200 }));

      const chunks: unknown[] = [];
      for await (const chunk of provider.chatCompletionStream(makeRequest())) {
        chunks.push(chunk);
      }

      expect(provider.lastFetchUrl).toContain(
        '/openai/deployments/my-gpt4-deployment/chat/completions',
      );

      const sentBody = JSON.parse(provider.lastFetchInit.body as string);
      expect(sentBody.stream).toBe(true);

      expect(chunks).toHaveLength(1);
    });

    it('overrides model in streamed chunks', async () => {
      const sseData = [
        'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}\n',
        'data: [DONE]\n',
      ].join('\n');

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseData));
          controller.close();
        },
      });

      provider.setMockResponse(new Response(stream, { status: 200 }));

      const chunks: any[] = [];
      for await (const chunk of provider.chatCompletionStream(makeRequest())) {
        chunks.push(chunk);
      }

      expect(chunks[0].model).toBe('azure/my-gpt4-deployment');
    });

    it('throws ProviderError on error response during streaming', async () => {
      provider.setMockResponse(
        new Response(
          JSON.stringify({ error: { message: 'Deployment not found' } }),
          { status: 404 },
        ),
      );

      await expect(async () => {
        for await (const _chunk of provider.chatCompletionStream(makeRequest())) {
          // consume
        }
      }).rejects.toThrow(ProviderError);
    });
  });

  describe('embedding', () => {
    it('calls the correct Azure embeddings URL', async () => {
      const responseBody = {
        object: 'list',
        data: [{ object: 'embedding', embedding: [0.1, 0.2], index: 0 }],
        model: 'text-embedding-ada-002',
        usage: { prompt_tokens: 5, total_tokens: 5 },
      };
      provider.setMockResponse(
        new Response(JSON.stringify(responseBody), { status: 200 }),
      );

      const deployment = makeDeployment({ modelName: 'my-embedding-deployment' });
      await provider.embedding({
        deployment,
        model: 'text-embedding-ada-002',
        input: 'Hello world',
      });

      expect(provider.lastFetchUrl).toBe(
        'https://my-resource.openai.azure.com/openai/deployments/my-embedding-deployment/embeddings?api-version=2024-06-01',
      );
    });
  });
});
