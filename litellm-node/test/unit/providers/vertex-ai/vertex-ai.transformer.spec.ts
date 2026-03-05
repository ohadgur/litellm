import {
  transformRequest,
  transformResponse,
  transformStreamChunk,
  stripModelPrefix,
  GeminiResponse,
} from '../../../../src/providers/vertex-ai/vertex-ai.transformer';
import { ChatCompletionRequest } from '../../../../src/shared/types';

describe('VertexAI Transformer', () => {
  describe('stripModelPrefix', () => {
    it('strips vertex_ai/ prefix', () => {
      expect(stripModelPrefix('vertex_ai/gemini-1.5-pro')).toBe(
        'gemini-1.5-pro',
      );
    });

    it('returns model unchanged when no prefix', () => {
      expect(stripModelPrefix('gemini-1.5-pro')).toBe('gemini-1.5-pro');
    });
  });

  describe('transformRequest', () => {
    it('maps user role to user', () => {
      const body: ChatCompletionRequest = {
        model: 'vertex_ai/gemini-1.5-pro',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const result = transformRequest(body);

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].role).toBe('user');
      expect(result.contents[0].parts).toEqual([{ text: 'Hello' }]);
    });

    it('maps assistant role to model', () => {
      const body: ChatCompletionRequest = {
        model: 'gemini-1.5-pro',
        messages: [
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello!' },
        ],
      };

      const result = transformRequest(body);

      expect(result.contents).toHaveLength(2);
      expect(result.contents[1].role).toBe('model');
      expect(result.contents[1].parts).toEqual([{ text: 'Hello!' }]);
    });

    it('extracts system message to systemInstruction', () => {
      const body: ChatCompletionRequest = {
        model: 'gemini-1.5-pro',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hi' },
        ],
      };

      const result = transformRequest(body);

      expect(result.systemInstruction).toEqual({
        parts: [{ text: 'You are a helpful assistant.' }],
      });
      // System message should not be in contents
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].role).toBe('user');
    });

    it('combines multiple system messages', () => {
      const body: ChatCompletionRequest = {
        model: 'gemini-1.5-pro',
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'system', content: 'Be concise.' },
          { role: 'user', content: 'Hi' },
        ],
      };

      const result = transformRequest(body);

      expect(result.systemInstruction!.parts).toHaveLength(2);
      expect(result.systemInstruction!.parts[0].text).toBe('You are helpful.');
      expect(result.systemInstruction!.parts[1].text).toBe('Be concise.');
    });

    it('converts tools to Gemini functionDeclarations', () => {
      const body: ChatCompletionRequest = {
        model: 'gemini-1.5-pro',
        messages: [{ role: 'user', content: 'What is the weather?' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get weather info',
              parameters: {
                type: 'object',
                properties: {
                  location: { type: 'string' },
                },
              },
            },
          },
        ],
      };

      const result = transformRequest(body);

      expect(result.tools).toHaveLength(1);
      expect(result.tools![0].functionDeclarations).toHaveLength(1);
      expect(result.tools![0].functionDeclarations[0]).toEqual({
        name: 'get_weather',
        description: 'Get weather info',
        parameters: {
          type: 'object',
          properties: { location: { type: 'string' } },
        },
      });
    });

    it('converts assistant tool_calls to functionCall parts', () => {
      const body: ChatCompletionRequest = {
        model: 'gemini-1.5-pro',
        messages: [
          { role: 'user', content: 'What is the weather?' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: '{"location":"NYC"}',
                },
              },
            ],
          },
        ],
      };

      const result = transformRequest(body);

      expect(result.contents).toHaveLength(2);
      const assistantContent = result.contents[1];
      expect(assistantContent.role).toBe('model');
      expect(assistantContent.parts).toEqual([
        {
          functionCall: {
            name: 'get_weather',
            args: { location: 'NYC' },
          },
        },
      ]);
    });

    it('converts tool role messages to functionResponse parts', () => {
      const body: ChatCompletionRequest = {
        model: 'gemini-1.5-pro',
        messages: [
          { role: 'user', content: 'Weather?' },
          {
            role: 'tool',
            content: '{"temp": 72}',
            name: 'get_weather',
            tool_call_id: 'call_1',
          },
        ],
      };

      const result = transformRequest(body);

      expect(result.contents).toHaveLength(2);
      const toolContent = result.contents[1];
      expect(toolContent.role).toBe('tool');
      expect(toolContent.parts).toEqual([
        {
          functionResponse: {
            name: 'get_weather',
            response: { temp: 72 },
          },
        },
      ]);
    });

    it('maps temperature to generationConfig', () => {
      const body: ChatCompletionRequest = {
        model: 'gemini-1.5-pro',
        messages: [{ role: 'user', content: 'Hi' }],
        temperature: 0.7,
      };

      const result = transformRequest(body);

      expect(result.generationConfig?.temperature).toBe(0.7);
    });

    it('maps max_tokens to generationConfig.maxOutputTokens', () => {
      const body: ChatCompletionRequest = {
        model: 'gemini-1.5-pro',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1024,
      };

      const result = transformRequest(body);

      expect(result.generationConfig?.maxOutputTokens).toBe(1024);
    });

    it('maps top_p to generationConfig.topP', () => {
      const body: ChatCompletionRequest = {
        model: 'gemini-1.5-pro',
        messages: [{ role: 'user', content: 'Hi' }],
        top_p: 0.9,
      };

      const result = transformRequest(body);

      expect(result.generationConfig?.topP).toBe(0.9);
    });

    it('maps stop string to generationConfig.stopSequences array', () => {
      const body: ChatCompletionRequest = {
        model: 'gemini-1.5-pro',
        messages: [{ role: 'user', content: 'Hi' }],
        stop: 'END',
      };

      const result = transformRequest(body);

      expect(result.generationConfig?.stopSequences).toEqual(['END']);
    });

    it('maps stop array to generationConfig.stopSequences', () => {
      const body: ChatCompletionRequest = {
        model: 'gemini-1.5-pro',
        messages: [{ role: 'user', content: 'Hi' }],
        stop: ['END', 'STOP'],
      };

      const result = transformRequest(body);

      expect(result.generationConfig?.stopSequences).toEqual(['END', 'STOP']);
    });

    it('omits generationConfig when no params set', () => {
      const body: ChatCompletionRequest = {
        model: 'gemini-1.5-pro',
        messages: [{ role: 'user', content: 'Hi' }],
      };

      const result = transformRequest(body);

      expect(result.generationConfig).toBeUndefined();
    });

    it('omits tools when none provided', () => {
      const body: ChatCompletionRequest = {
        model: 'gemini-1.5-pro',
        messages: [{ role: 'user', content: 'Hi' }],
      };

      const result = transformRequest(body);

      expect(result.tools).toBeUndefined();
    });
  });

  describe('transformResponse', () => {
    it('extracts text content from candidates', () => {
      const gemini: GeminiResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Hello there!' }],
              role: 'model',
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      };

      const result = transformResponse(gemini, 'gemini-1.5-pro');

      expect(result.choices[0].message.content).toBe('Hello there!');
      expect(result.choices[0].message.role).toBe('assistant');
      expect(result.choices[0].finish_reason).toBe('stop');
      expect(result.model).toBe('gemini-1.5-pro');
    });

    it('maps STOP finish reason to stop', () => {
      const gemini: GeminiResponse = {
        candidates: [
          {
            content: { parts: [{ text: 'done' }] },
            finishReason: 'STOP',
          },
        ],
      };

      const result = transformResponse(gemini, 'gemini-1.5-pro');
      expect(result.choices[0].finish_reason).toBe('stop');
    });

    it('maps MAX_TOKENS finish reason to length', () => {
      const gemini: GeminiResponse = {
        candidates: [
          {
            content: { parts: [{ text: 'truncated' }] },
            finishReason: 'MAX_TOKENS',
          },
        ],
      };

      const result = transformResponse(gemini, 'gemini-1.5-pro');
      expect(result.choices[0].finish_reason).toBe('length');
    });

    it('maps SAFETY finish reason to content_filter', () => {
      const gemini: GeminiResponse = {
        candidates: [
          {
            content: { parts: [] },
            finishReason: 'SAFETY',
          },
        ],
      };

      const result = transformResponse(gemini, 'gemini-1.5-pro');
      expect(result.choices[0].finish_reason).toBe('content_filter');
    });

    it('extracts usage metadata', () => {
      const gemini: GeminiResponse = {
        candidates: [
          { content: { parts: [{ text: 'Hi' }] }, finishReason: 'STOP' },
        ],
        usageMetadata: {
          promptTokenCount: 20,
          candidatesTokenCount: 10,
          totalTokenCount: 30,
        },
      };

      const result = transformResponse(gemini, 'gemini-1.5-pro');

      expect(result.usage).toEqual({
        prompt_tokens: 20,
        completion_tokens: 10,
        total_tokens: 30,
      });
    });

    it('extracts functionCall parts as tool_calls', () => {
      const gemini: GeminiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'get_weather',
                    args: { location: 'NYC' },
                  },
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      };

      const result = transformResponse(gemini, 'gemini-1.5-pro');

      expect(result.choices[0].message.tool_calls).toHaveLength(1);
      expect(result.choices[0].message.tool_calls![0]).toEqual({
        id: 'call_0',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: '{"location":"NYC"}',
        },
      });
      // content should be null when only function calls
      expect(result.choices[0].message.content).toBeNull();
    });

    it('handles empty candidates gracefully', () => {
      const gemini: GeminiResponse = { candidates: [] };

      const result = transformResponse(gemini, 'gemini-1.5-pro');

      expect(result.choices[0].message.content).toBeNull();
      expect(result.choices[0].finish_reason).toBeNull();
    });
  });

  describe('transformStreamChunk', () => {
    it('includes role on first chunk', () => {
      const gemini: GeminiResponse = {
        candidates: [
          {
            content: { parts: [{ text: 'Hi' }] },
            finishReason: undefined,
          },
        ],
      };

      const result = transformStreamChunk(gemini, 'gemini-1.5-pro', 0);

      expect(result.choices[0].delta.role).toBe('assistant');
      expect(result.choices[0].delta.content).toBe('Hi');
      expect(result.object).toBe('chat.completion.chunk');
    });

    it('omits role on subsequent chunks', () => {
      const gemini: GeminiResponse = {
        candidates: [
          {
            content: { parts: [{ text: 'there' }] },
            finishReason: undefined,
          },
        ],
      };

      const result = transformStreamChunk(gemini, 'gemini-1.5-pro', 1);

      expect(result.choices[0].delta.role).toBeUndefined();
      expect(result.choices[0].delta.content).toBe('there');
    });

    it('maps finish reason in stream chunk', () => {
      const gemini: GeminiResponse = {
        candidates: [
          {
            content: { parts: [] },
            finishReason: 'STOP',
          },
        ],
      };

      const result = transformStreamChunk(gemini, 'gemini-1.5-pro', 2);

      expect(result.choices[0].finish_reason).toBe('stop');
    });
  });
});
