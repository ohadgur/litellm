import {
  transformRequest,
  transformResponse,
  transformStreamEvent,
  stripModelPrefix,
  mapStopReason,
  BedrockConverseResponse,
} from '../../../../src/providers/bedrock/bedrock.transformer';
import { ChatCompletionRequest } from '../../../../src/shared/types';

describe('BedrockTransformer', () => {
  describe('stripModelPrefix', () => {
    it('strips bedrock/ prefix', () => {
      expect(stripModelPrefix('bedrock/us.anthropic.claude-3-5-sonnet-20240620-v1:0'))
        .toBe('us.anthropic.claude-3-5-sonnet-20240620-v1:0');
    });

    it('returns model as-is when no prefix', () => {
      expect(stripModelPrefix('anthropic.claude-v2')).toBe('anthropic.claude-v2');
    });
  });

  describe('mapStopReason', () => {
    it('maps end_turn to stop', () => {
      expect(mapStopReason('end_turn')).toBe('stop');
    });

    it('maps max_tokens to length', () => {
      expect(mapStopReason('max_tokens')).toBe('length');
    });

    it('maps tool_use to tool_calls', () => {
      expect(mapStopReason('tool_use')).toBe('tool_calls');
    });

    it('maps stop_sequence to stop', () => {
      expect(mapStopReason('stop_sequence')).toBe('stop');
    });

    it('returns null for undefined', () => {
      expect(mapStopReason(undefined)).toBeNull();
    });

    it('passes through unknown reasons', () => {
      expect(mapStopReason('custom_reason')).toBe('custom_reason');
    });
  });

  describe('transformRequest', () => {
    it('converts simple text message', () => {
      const request: ChatCompletionRequest = {
        model: 'bedrock/anthropic.claude-v2',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const result = transformRequest(request, 'anthropic.claude-v2');

      expect(result.modelId).toBe('anthropic.claude-v2');
      expect(result.messages).toEqual([
        { role: 'user', content: [{ text: 'Hello' }] },
      ]);
    });

    it('extracts system messages into system field', () => {
      const request: ChatCompletionRequest = {
        model: 'bedrock/claude',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hi' },
        ],
      };

      const result = transformRequest(request, 'claude');

      expect(result.system).toEqual([{ text: 'You are helpful' }]);
      expect(result.messages).toEqual([
        { role: 'user', content: [{ text: 'Hi' }] },
      ]);
    });

    it('handles multiple system messages', () => {
      const request: ChatCompletionRequest = {
        model: 'bedrock/claude',
        messages: [
          { role: 'system', content: 'Rule 1' },
          { role: 'system', content: 'Rule 2' },
          { role: 'user', content: 'Hi' },
        ],
      };

      const result = transformRequest(request, 'claude');

      expect(result.system).toEqual([{ text: 'Rule 1' }, { text: 'Rule 2' }]);
    });

    it('converts assistant message with tool_calls', () => {
      const request: ChatCompletionRequest = {
        model: 'bedrock/claude',
        messages: [
          {
            role: 'assistant',
            content: 'Let me check',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: '{"city":"London"}',
                },
              },
            ],
          },
        ],
      };

      const result = transformRequest(request, 'claude');

      expect(result.messages[0].content).toEqual([
        { text: 'Let me check' },
        {
          toolUse: {
            toolUseId: 'call_1',
            name: 'get_weather',
            input: { city: 'London' },
          },
        },
      ]);
    });

    it('converts tool result message', () => {
      const request: ChatCompletionRequest = {
        model: 'bedrock/claude',
        messages: [
          {
            role: 'tool',
            content: '{"temp": 20}',
            tool_call_id: 'call_1',
          },
        ],
      };

      const result = transformRequest(request, 'claude');

      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content).toEqual([
        {
          toolResult: {
            toolUseId: 'call_1',
            content: [{ text: '{"temp": 20}' }],
          },
        },
      ]);
    });

    it('converts tools to toolConfig', () => {
      const request: ChatCompletionRequest = {
        model: 'bedrock/claude',
        messages: [{ role: 'user', content: 'Hi' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get weather info',
              parameters: {
                type: 'object',
                properties: { city: { type: 'string' } },
              },
            },
          },
        ],
      };

      const result = transformRequest(request, 'claude');

      expect(result.toolConfig).toEqual({
        tools: [
          {
            toolSpec: {
              name: 'get_weather',
              description: 'Get weather info',
              inputSchema: {
                json: {
                  type: 'object',
                  properties: { city: { type: 'string' } },
                },
              },
            },
          },
        ],
      });
    });

    it('maps inference config parameters', () => {
      const request: ChatCompletionRequest = {
        model: 'bedrock/claude',
        messages: [{ role: 'user', content: 'Hi' }],
        temperature: 0.7,
        max_tokens: 200,
        top_p: 0.9,
        stop: ['END'],
      };

      const result = transformRequest(request, 'claude');

      expect(result.inferenceConfig).toEqual({
        temperature: 0.7,
        maxTokens: 200,
        topP: 0.9,
        stopSequences: ['END'],
      });
    });

    it('handles stop as string', () => {
      const request: ChatCompletionRequest = {
        model: 'bedrock/claude',
        messages: [{ role: 'user', content: 'Hi' }],
        stop: 'STOP',
      };

      const result = transformRequest(request, 'claude');

      expect(result.inferenceConfig?.stopSequences).toEqual(['STOP']);
    });

    it('omits inferenceConfig when no params set', () => {
      const request: ChatCompletionRequest = {
        model: 'bedrock/claude',
        messages: [{ role: 'user', content: 'Hi' }],
      };

      const result = transformRequest(request, 'claude');

      expect(result.inferenceConfig).toBeUndefined();
    });

    it('omits system field when no system messages', () => {
      const request: ChatCompletionRequest = {
        model: 'bedrock/claude',
        messages: [{ role: 'user', content: 'Hi' }],
      };

      const result = transformRequest(request, 'claude');

      expect(result.system).toBeUndefined();
    });

    it('omits toolConfig when no tools', () => {
      const request: ChatCompletionRequest = {
        model: 'bedrock/claude',
        messages: [{ role: 'user', content: 'Hi' }],
      };

      const result = transformRequest(request, 'claude');

      expect(result.toolConfig).toBeUndefined();
    });
  });

  describe('transformResponse', () => {
    it('converts text response', () => {
      const bedrockResponse: BedrockConverseResponse = {
        output: {
          message: {
            role: 'assistant',
            content: [{ text: 'Hello there!' }],
          },
        },
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 5 },
      };

      const result = transformResponse(bedrockResponse, 'claude-v2');

      expect(result.object).toBe('chat.completion');
      expect(result.model).toBe('claude-v2');
      expect(result.choices[0].message.role).toBe('assistant');
      expect(result.choices[0].message.content).toBe('Hello there!');
      expect(result.choices[0].finish_reason).toBe('stop');
      expect(result.usage).toEqual({
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      });
    });

    it('converts tool_use response', () => {
      const bedrockResponse: BedrockConverseResponse = {
        output: {
          message: {
            role: 'assistant',
            content: [
              { text: 'I will check' },
              {
                toolUse: {
                  toolUseId: 'call_abc',
                  name: 'get_weather',
                  input: { city: 'Paris' },
                },
              },
            ],
          },
        },
        stopReason: 'tool_use',
        usage: { inputTokens: 15, outputTokens: 20 },
      };

      const result = transformResponse(bedrockResponse, 'claude-v2');

      expect(result.choices[0].message.content).toBe('I will check');
      expect(result.choices[0].message.tool_calls).toEqual([
        {
          id: 'call_abc',
          type: 'function',
          function: {
            name: 'get_weather',
            arguments: '{"city":"Paris"}',
          },
        },
      ]);
      expect(result.choices[0].finish_reason).toBe('tool_calls');
    });

    it('handles empty content', () => {
      const bedrockResponse: BedrockConverseResponse = {
        output: { message: { role: 'assistant', content: [] } },
        stopReason: 'end_turn',
        usage: { inputTokens: 5, outputTokens: 0 },
      };

      const result = transformResponse(bedrockResponse, 'claude-v2');

      expect(result.choices[0].message.content).toBeNull();
      expect(result.choices[0].message.tool_calls).toBeUndefined();
    });

    it('handles missing usage', () => {
      const bedrockResponse: BedrockConverseResponse = {
        output: {
          message: {
            role: 'assistant',
            content: [{ text: 'Hi' }],
          },
        },
        stopReason: 'end_turn',
      };

      const result = transformResponse(bedrockResponse, 'claude-v2');

      expect(result.usage).toEqual({
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      });
    });
  });

  describe('transformStreamEvent', () => {
    const model = 'claude-v2';
    const streamId = 'chatcmpl-test';

    it('transforms messageStart event', () => {
      const chunk = transformStreamEvent(
        { messageStart: { role: 'assistant' } },
        model,
        streamId,
      );

      expect(chunk).not.toBeNull();
      expect(chunk!.choices[0].delta.role).toBe('assistant');
    });

    it('transforms text contentBlockDelta', () => {
      const chunk = transformStreamEvent(
        {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { text: 'Hello' },
          },
        },
        model,
        streamId,
      );

      expect(chunk).not.toBeNull();
      expect(chunk!.choices[0].delta.content).toBe('Hello');
    });

    it('transforms toolUse contentBlockStart', () => {
      const chunk = transformStreamEvent(
        {
          contentBlockStart: {
            contentBlockIndex: 0,
            start: { toolUse: { toolUseId: 'call_1', name: 'get_weather' } },
          },
        },
        model,
        streamId,
      );

      expect(chunk).not.toBeNull();
      expect(chunk!.choices[0].delta.tool_calls).toEqual([
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'get_weather', arguments: '' },
        },
      ]);
    });

    it('transforms toolUse contentBlockDelta', () => {
      const chunk = transformStreamEvent(
        {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { toolUse: { input: '{"city":"NYC"}' } },
          },
        },
        model,
        streamId,
      );

      expect(chunk).not.toBeNull();
      expect(chunk!.choices[0].delta.tool_calls).toEqual([
        { function: { name: '', arguments: '{"city":"NYC"}' } },
      ]);
    });

    it('transforms messageStop event', () => {
      const chunk = transformStreamEvent(
        { messageStop: { stopReason: 'end_turn' } },
        model,
        streamId,
      );

      expect(chunk).not.toBeNull();
      expect(chunk!.choices[0].finish_reason).toBe('stop');
    });

    it('transforms metadata event with usage', () => {
      const chunk = transformStreamEvent(
        {
          metadata: {
            usage: { inputTokens: 10, outputTokens: 20 },
          },
        },
        model,
        streamId,
      );

      expect(chunk).not.toBeNull();
      expect(chunk!.usage).toEqual({
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      });
    });

    it('returns null for contentBlockStop', () => {
      const chunk = transformStreamEvent(
        { contentBlockStop: { contentBlockIndex: 0 } },
        model,
        streamId,
      );

      expect(chunk).toBeNull();
    });

    it('returns null for empty event', () => {
      const chunk = transformStreamEvent({}, model, streamId);
      expect(chunk).toBeNull();
    });
  });
});
