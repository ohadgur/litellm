import {
  extractSystemMessages,
  convertMessages,
  convertTools,
  transformRequest,
  transformResponse,
  mapStopReason,
  stripModelPrefix,
  StreamTransformer,
  AnthropicResponse,
  AnthropicStreamEvent,
  AnthropicToolUseBlock,
  AnthropicToolResultBlock,
} from '../../../../src/providers/anthropic/anthropic.transformer';
import {
  ChatCompletionRequest,
  OpenAIMessage,
  OpenAIToolParam,
} from '../../../../src/providers/types/llm-provider.interface';

// ---------------------------------------------------------------------------
// extractSystemMessages
// ---------------------------------------------------------------------------

describe('extractSystemMessages', () => {
  it('should extract a single string system message', () => {
    const messages: OpenAIMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hi' },
    ];
    const { system, filtered } = extractSystemMessages(messages);
    expect(system).toBe('You are helpful.');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].role).toBe('user');
  });

  it('should merge multiple system messages into content blocks', () => {
    const messages: OpenAIMessage[] = [
      { role: 'system', content: 'System 1' },
      { role: 'system', content: 'System 2' },
      { role: 'user', content: 'Hello' },
    ];
    const { system, filtered } = extractSystemMessages(messages);
    expect(Array.isArray(system)).toBe(true);
    expect(system).toHaveLength(2);
    expect(filtered).toHaveLength(1);
  });

  it('should return undefined system when no system messages', () => {
    const messages: OpenAIMessage[] = [{ role: 'user', content: 'Hello' }];
    const { system, filtered } = extractSystemMessages(messages);
    expect(system).toBeUndefined();
    expect(filtered).toHaveLength(1);
  });

  it('should skip empty system messages', () => {
    const messages: OpenAIMessage[] = [
      { role: 'system', content: '' },
      { role: 'user', content: 'Hello' },
    ];
    const { system, filtered } = extractSystemMessages(messages);
    expect(system).toBeUndefined();
    expect(filtered).toHaveLength(1);
  });

  it('should handle system messages with content block arrays', () => {
    const messages: OpenAIMessage[] = [
      {
        role: 'system',
        content: [{ type: 'text', text: 'Be concise.' }],
      },
      { role: 'user', content: 'Hi' },
    ];
    const { system } = extractSystemMessages(messages);
    expect(system).toBe('Be concise.');
  });
});

// ---------------------------------------------------------------------------
// convertMessages -- tool_calls and tool results
// ---------------------------------------------------------------------------

describe('convertMessages', () => {
  it('should convert user and assistant messages', () => {
    const messages: OpenAIMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];
    const result = convertMessages(messages);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('user');
    expect(result[0].content).toBe('Hello');
    expect(result[1].role).toBe('assistant');
  });

  it('should convert assistant tool_calls to tool_use blocks', () => {
    const messages: OpenAIMessage[] = [
      {
        role: 'assistant',
        tool_calls: [
          {
            id: 'call_123',
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: '{"city":"NYC"}',
            },
          },
        ],
      },
    ];
    const result = convertMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('assistant');
    const content = result[0].content as unknown[];
    expect(content).toHaveLength(1);
    const toolUse = content[0] as AnthropicToolUseBlock;
    expect(toolUse.type).toBe('tool_use');
    expect(toolUse.id).toBe('call_123');
    expect(toolUse.name).toBe('get_weather');
    expect(toolUse.input).toEqual({ city: 'NYC' });
  });

  it('should convert tool role messages to user messages with tool_result', () => {
    const messages: OpenAIMessage[] = [
      { role: 'tool', tool_call_id: 'call_123', content: '72F' },
    ];
    const result = convertMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
    const content = result[0].content as unknown[];
    expect(content).toHaveLength(1);
    const toolResult = content[0] as AnthropicToolResultBlock;
    expect(toolResult.type).toBe('tool_result');
    expect(toolResult.tool_use_id).toBe('call_123');
    expect(toolResult.content).toBe('72F');
  });

  it('should merge consecutive user messages (tool results)', () => {
    const messages: OpenAIMessage[] = [
      { role: 'tool', tool_call_id: 'call_1', content: 'result 1' },
      { role: 'tool', tool_call_id: 'call_2', content: 'result 2' },
    ];
    const result = convertMessages(messages);
    // Both tool messages become user role -> merged into one
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
    const content = result[0].content as unknown[];
    expect(content).toHaveLength(2);
  });

  it('should handle assistant message with both text and tool_calls', () => {
    const messages: OpenAIMessage[] = [
      {
        role: 'assistant',
        content: 'Let me check the weather.',
        tool_calls: [
          {
            id: 'call_456',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"LA"}' },
          },
        ],
      },
    ];
    const result = convertMessages(messages);
    const content = result[0].content as unknown[];
    expect(content).toHaveLength(2);
    expect((content[0] as { type: string }).type).toBe('text');
    expect((content[1] as { type: string }).type).toBe('tool_use');
  });

  it('should handle image content blocks', () => {
    const messages: OpenAIMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is in this image?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } },
        ],
      },
    ];
    const result = convertMessages(messages);
    const content = result[0].content as unknown[];
    expect(content).toHaveLength(2);
    expect((content[0] as { type: string }).type).toBe('text');
    expect((content[1] as { type: string }).type).toBe('image');
  });
});

// ---------------------------------------------------------------------------
// convertTools
// ---------------------------------------------------------------------------

describe('convertTools', () => {
  it('should convert OpenAI tools to Anthropic format', () => {
    const tools: OpenAIToolParam[] = [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get the current weather',
          parameters: {
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
          },
        },
      },
    ];
    const result = convertTools(tools);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('get_weather');
    expect(result[0].description).toBe('Get the current weather');
    expect(result[0].input_schema).toEqual({
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    });
  });

  it('should default input_schema when parameters missing', () => {
    const tools: OpenAIToolParam[] = [
      { type: 'function', function: { name: 'no_params' } },
    ];
    const result = convertTools(tools);
    expect(result[0].input_schema).toEqual({ type: 'object', properties: {} });
  });
});

// ---------------------------------------------------------------------------
// transformRequest (full request)
// ---------------------------------------------------------------------------

describe('transformRequest', () => {
  it('should build a complete Anthropic request', () => {
    const request: ChatCompletionRequest = {
      model: 'anthropic/claude-sonnet-4-20250514',
      messages: [
        { role: 'system', content: 'Be helpful.' },
        { role: 'user', content: 'Hi' },
      ],
      temperature: 0.7,
      max_tokens: 1024,
      stop: ['END'],
    };
    const result = transformRequest(request, 'claude-sonnet-4-20250514');
    expect(result.model).toBe('claude-sonnet-4-20250514');
    expect(result.system).toBe('Be helpful.');
    expect(result.messages).toHaveLength(1);
    expect(result.temperature).toBe(0.7);
    expect(result.max_tokens).toBe(1024);
    expect(result.stop_sequences).toEqual(['END']);
  });

  it('should default max_tokens to 4096', () => {
    const request: ChatCompletionRequest = {
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hi' }],
    };
    const result = transformRequest(request, 'claude-sonnet-4-20250514');
    expect(result.max_tokens).toBe(4096);
  });

  it('should handle stop as a string', () => {
    const request: ChatCompletionRequest = {
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hi' }],
      stop: 'STOP',
    };
    const result = transformRequest(request, 'claude-sonnet-4-20250514');
    expect(result.stop_sequences).toEqual(['STOP']);
  });
});

// ---------------------------------------------------------------------------
// transformResponse
// ---------------------------------------------------------------------------

describe('transformResponse', () => {
  it('should convert a text response', () => {
    const anthropicResponse: AnthropicResponse = {
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello!' }],
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    const result = transformResponse(anthropicResponse, 'claude-sonnet-4-20250514');
    expect(result.id).toBe('chatcmpl-msg_123');
    expect(result.object).toBe('chat.completion');
    expect(result.choices[0].message.content).toBe('Hello!');
    expect(result.choices[0].message.role).toBe('assistant');
    expect(result.choices[0].finish_reason).toBe('stop');
    expect(result.usage.prompt_tokens).toBe(10);
    expect(result.usage.completion_tokens).toBe(5);
    expect(result.usage.total_tokens).toBe(15);
  });

  it('should convert a tool_use response', () => {
    const anthropicResponse: AnthropicResponse = {
      id: 'msg_456',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'call_789',
          name: 'get_weather',
          input: { city: 'NYC' },
        },
      ],
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'tool_use',
      usage: { input_tokens: 20, output_tokens: 30 },
    };
    const result = transformResponse(anthropicResponse, 'claude-sonnet-4-20250514');
    expect(result.choices[0].message.tool_calls).toHaveLength(1);
    const tc = result.choices[0].message.tool_calls![0];
    expect(tc.id).toBe('call_789');
    expect(tc.type).toBe('function');
    expect(tc.function.name).toBe('get_weather');
    expect(JSON.parse(tc.function.arguments)).toEqual({ city: 'NYC' });
    expect(result.choices[0].finish_reason).toBe('tool_calls');
  });

  it('should handle mixed text and tool_use content', () => {
    const anthropicResponse: AnthropicResponse = {
      id: 'msg_mix',
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'text', text: 'Here is the result:' },
        { type: 'tool_use', id: 'c1', name: 'fn', input: {} },
      ],
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'tool_use',
      usage: { input_tokens: 5, output_tokens: 10 },
    };
    const result = transformResponse(anthropicResponse, 'claude-sonnet-4-20250514');
    expect(result.choices[0].message.content).toBe('Here is the result:');
    expect(result.choices[0].message.tool_calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// mapStopReason
// ---------------------------------------------------------------------------

describe('mapStopReason', () => {
  it.each([
    ['end_turn', 'stop'],
    ['max_tokens', 'length'],
    ['tool_use', 'tool_calls'],
    ['stop_sequence', 'stop'],
    [null, null],
  ])('should map %s to %s', (input, expected) => {
    expect(mapStopReason(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// stripModelPrefix
// ---------------------------------------------------------------------------

describe('stripModelPrefix', () => {
  it('should strip anthropic/ prefix', () => {
    expect(stripModelPrefix('anthropic/claude-sonnet-4-20250514')).toBe('claude-sonnet-4-20250514');
  });

  it('should leave model unchanged without prefix', () => {
    expect(stripModelPrefix('claude-sonnet-4-20250514')).toBe('claude-sonnet-4-20250514');
  });
});

// ---------------------------------------------------------------------------
// StreamTransformer
// ---------------------------------------------------------------------------

describe('StreamTransformer', () => {
  let transformer: StreamTransformer;

  beforeEach(() => {
    transformer = new StreamTransformer();
    // Initialize with message_start
    transformer.transform({
      type: 'message_start',
      message: {
        id: 'msg_stream1',
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    });
  });

  it('should return null for message_start', () => {
    const t = new StreamTransformer();
    const result = t.transform({
      type: 'message_start',
      message: {
        id: 'msg_x',
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 5, output_tokens: 0 },
      },
    });
    expect(result).toBeNull();
  });

  it('should return text delta chunk', () => {
    const chunk = transformer.transform({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Hello' },
    });
    expect(chunk).not.toBeNull();
    expect(chunk!.choices[0].delta.content).toBe('Hello');
    expect(chunk!.id).toBe('chatcmpl-msg_stream1');
    expect(chunk!.object).toBe('chat.completion.chunk');
  });

  it('should return tool_use start chunk', () => {
    const chunk = transformer.transform({
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'tool_use',
        id: 'call_s1',
        name: 'get_weather',
        input: {},
      },
    });
    expect(chunk).not.toBeNull();
    expect(chunk!.choices[0].delta.tool_calls).toHaveLength(1);
    expect(chunk!.choices[0].delta.tool_calls![0].function!.name).toBe('get_weather');
  });

  it('should return input_json_delta as tool arguments', () => {
    // First start the tool block
    transformer.transform({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'call_s2', name: 'fn', input: {} },
    });
    const chunk = transformer.transform({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"key":' },
    });
    expect(chunk).not.toBeNull();
    expect(chunk!.choices[0].delta.tool_calls![0].function!.arguments).toBe('{"key":');
  });

  it('should return finish_reason on message_delta', () => {
    const chunk = transformer.transform({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 42 },
    });
    expect(chunk).not.toBeNull();
    expect(chunk!.choices[0].finish_reason).toBe('stop');
    expect(chunk!.usage!.completion_tokens).toBe(42);
  });

  it('should return null for content_block_stop', () => {
    const result = transformer.transform({ type: 'content_block_stop', index: 0 });
    expect(result).toBeNull();
  });

  it('should return null for message_stop', () => {
    const result = transformer.transform({ type: 'message_stop' });
    expect(result).toBeNull();
  });
});
