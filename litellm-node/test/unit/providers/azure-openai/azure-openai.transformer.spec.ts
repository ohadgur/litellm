import {
  transformRequest,
  transformResponse,
  transformStreamChunk,
  buildAzureUrl,
  buildAzureHeaders,
  extractDeploymentName,
} from '../../../../src/providers/azure-openai/azure-openai.transformer';
import {
  ChatCompletionRequest,
  Deployment,
} from '../../../../src/shared/types';

const makeDeployment = (overrides: Partial<Deployment> = {}): Deployment => ({
  modelName: 'my-gpt4-deployment',
  apiKey: 'abc123',
  apiBase: 'https://my-resource.openai.azure.com',
  provider: 'azure',
  ...overrides,
});

describe('Azure OpenAI Transformer', () => {
  describe('extractDeploymentName', () => {
    it('strips azure/ prefix', () => {
      expect(extractDeploymentName('azure/my-gpt4-deployment')).toBe('my-gpt4-deployment');
    });

    it('returns name unchanged when no prefix', () => {
      expect(extractDeploymentName('my-gpt4-deployment')).toBe('my-gpt4-deployment');
    });

    it('only strips the first azure/ prefix', () => {
      expect(extractDeploymentName('azure/azure/nested')).toBe('azure/nested');
    });
  });

  describe('buildAzureUrl', () => {
    it('constructs correct chat completions URL', () => {
      const deployment = makeDeployment();
      const url = buildAzureUrl(deployment, 'chat/completions');
      expect(url).toBe(
        'https://my-resource.openai.azure.com/openai/deployments/my-gpt4-deployment/chat/completions?api-version=2024-06-01',
      );
    });

    it('constructs correct embeddings URL', () => {
      const deployment = makeDeployment();
      const url = buildAzureUrl(deployment, 'embeddings');
      expect(url).toBe(
        'https://my-resource.openai.azure.com/openai/deployments/my-gpt4-deployment/embeddings?api-version=2024-06-01',
      );
    });

    it('strips azure/ prefix from model name in URL', () => {
      const deployment = makeDeployment({ modelName: 'azure/gpt-4-turbo' });
      const url = buildAzureUrl(deployment, 'chat/completions');
      expect(url).toContain('/deployments/gpt-4-turbo/');
    });

    it('uses custom api version', () => {
      const deployment = makeDeployment();
      const url = buildAzureUrl(deployment, 'chat/completions', '2024-10-01');
      expect(url).toContain('api-version=2024-10-01');
    });

    it('strips trailing slash from apiBase', () => {
      const deployment = makeDeployment({
        apiBase: 'https://my-resource.openai.azure.com/',
      });
      const url = buildAzureUrl(deployment, 'chat/completions');
      expect(url).toContain(
        'https://my-resource.openai.azure.com/openai/deployments/',
      );
      expect(url).not.toContain('.com//');
    });
  });

  describe('buildAzureHeaders', () => {
    it('uses api-key header instead of Authorization Bearer', () => {
      const deployment = makeDeployment();
      const headers = buildAzureHeaders(deployment);
      expect(headers['api-key']).toBe('abc123');
      expect(headers['Authorization']).toBeUndefined();
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('merges extra headers', () => {
      const deployment = makeDeployment();
      const headers = buildAzureHeaders(deployment, { 'X-Custom': 'value' });
      expect(headers['api-key']).toBe('abc123');
      expect(headers['X-Custom']).toBe('value');
    });
  });

  describe('transformRequest', () => {
    it('removes model from request body', () => {
      const body: ChatCompletionRequest = {
        model: 'azure/my-gpt4-deployment',
        messages: [{ role: 'user', content: 'Hello' }],
      };
      const deployment = makeDeployment();

      const result = transformRequest(body, deployment);

      expect(result['model']).toBeUndefined();
      expect(result.messages).toEqual(body.messages);
    });

    it('preserves standard OpenAI params except model', () => {
      const body: ChatCompletionRequest = {
        model: 'azure/my-gpt4-deployment',
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 100,
        tools: [
          {
            type: 'function',
            function: { name: 'test', description: 'test fn' },
          },
        ],
        response_format: { type: 'json_object' },
        seed: 42,
      };
      const deployment = makeDeployment();

      const result = transformRequest(body, deployment);

      expect(result['model']).toBeUndefined();
      expect(result['temperature']).toBe(0.7);
      expect(result['top_p']).toBe(0.9);
      expect(result['max_tokens']).toBe(100);
      expect(result['tools']).toEqual(body.tools);
      expect(result['response_format']).toEqual({ type: 'json_object' });
      expect(result['seed']).toBe(42);
    });

    it('strips non-standard params', () => {
      const body: ChatCompletionRequest = {
        model: 'azure/my-gpt4-deployment',
        messages: [{ role: 'user', content: 'Hi' }],
        custom_param: 'should_be_removed',
        litellm_metadata: { key: 'value' },
      };
      const deployment = makeDeployment();

      const result = transformRequest(body, deployment);

      expect(result['custom_param']).toBeUndefined();
      expect(result['litellm_metadata']).toBeUndefined();
    });

    it('omits undefined values', () => {
      const body: ChatCompletionRequest = {
        model: 'azure/my-gpt4-deployment',
        messages: [{ role: 'user', content: 'Hi' }],
        temperature: undefined,
      };
      const deployment = makeDeployment();

      const result = transformRequest(body, deployment);

      expect('temperature' in result).toBe(false);
    });
  });

  describe('transformResponse', () => {
    it('passes through the response with model override', () => {
      const response = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello!' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };

      const result = transformResponse(response, 'azure/my-gpt4-deployment');

      expect(result.model).toBe('azure/my-gpt4-deployment');
      expect(result.choices).toEqual(response.choices);
    });

    it('preserves original model when no override provided', () => {
      const response = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };

      const result = transformResponse(response);

      expect(result.model).toBe('gpt-4');
    });
  });

  describe('transformStreamChunk', () => {
    it('passes through the chunk with model override', () => {
      const chunk = {
        id: 'chatcmpl-123',
        object: 'chat.completion.chunk',
        created: 1234567890,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            delta: { content: 'Hello' },
            finish_reason: null,
          },
        ],
      };

      const result = transformStreamChunk(chunk, 'azure/my-gpt4-deployment');

      expect(result.model).toBe('azure/my-gpt4-deployment');
      expect(result.choices).toEqual(chunk.choices);
    });
  });
});
