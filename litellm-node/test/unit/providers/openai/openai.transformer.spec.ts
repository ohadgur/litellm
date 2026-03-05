import {
  transformRequest,
  transformResponse,
  transformStreamChunk,
} from '../../../../src/providers/openai/openai.transformer';
import {
  ChatCompletionRequest,
  Deployment,
} from '../../../../src/shared/types';

const makeDeployment = (overrides: Partial<Deployment> = {}): Deployment => ({
  modelName: 'gpt-4',
  apiKey: 'sk-test',
  provider: 'openai',
  ...overrides,
});

describe('OpenAI Transformer', () => {
  describe('transformRequest', () => {
    it('preserves all standard OpenAI params', () => {
      const body: ChatCompletionRequest = {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 100,
        stream: false,
        tools: [
          {
            type: 'function',
            function: { name: 'test', description: 'test fn' },
          },
        ],
        response_format: { type: 'json_object' },
        seed: 42,
        user: 'user-123',
      };
      const deployment = makeDeployment();

      const result = transformRequest(body, deployment);

      expect(result.model).toBe('gpt-4'); // uses deployment model
      expect(result['temperature']).toBe(0.7);
      expect(result['top_p']).toBe(0.9);
      expect(result['max_tokens']).toBe(100);
      expect(result['tools']).toEqual(body.tools);
      expect(result['response_format']).toEqual({ type: 'json_object' });
      expect(result['seed']).toBe(42);
      expect(result['user']).toBe('user-123');
    });

    it('strips non-standard params', () => {
      const body: ChatCompletionRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        custom_param: 'should_be_removed',
        litellm_metadata: { key: 'value' },
      };
      const deployment = makeDeployment();

      const result = transformRequest(body, deployment);

      expect(result['custom_param']).toBeUndefined();
      expect(result['litellm_metadata']).toBeUndefined();
      expect(result.model).toBe('gpt-4');
      expect(result.messages).toEqual(body.messages);
    });

    it('uses deployment model name over body model', () => {
      const body: ChatCompletionRequest = {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Hi' }],
      };
      const deployment = makeDeployment({ modelName: 'gpt-4-turbo' });

      const result = transformRequest(body, deployment);

      expect(result.model).toBe('gpt-4-turbo');
    });

    it('omits undefined values', () => {
      const body: ChatCompletionRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        temperature: undefined,
      };
      const deployment = makeDeployment();

      const result = transformRequest(body, deployment);

      expect('temperature' in result).toBe(false);
    });
  });

  describe('transformResponse', () => {
    it('passes through the response object unchanged', () => {
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

      const result = transformResponse(response);

      expect(result).toEqual(response);
    });
  });

  describe('transformStreamChunk', () => {
    it('passes through the chunk object unchanged', () => {
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

      const result = transformStreamChunk(chunk);

      expect(result).toEqual(chunk);
    });
  });
});
