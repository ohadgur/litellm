import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ChatCompletionChunkDelta,
  ChatCompletionMessage,
  ToolCall,
  Tool,
  Usage,
} from '../../shared/types';

// ---------------------------------------------------------------------------
// Bedrock Converse API types
// ---------------------------------------------------------------------------

export interface BedrockContentBlock {
  text?: string;
  toolUse?: {
    toolUseId: string;
    name: string;
    input: Record<string, unknown>;
  };
  toolResult?: {
    toolUseId: string;
    content: { text: string }[];
  };
}

export interface BedrockMessage {
  role: 'user' | 'assistant';
  content: BedrockContentBlock[];
}

export interface BedrockToolSpec {
  toolSpec: {
    name: string;
    description?: string;
    inputSchema: {
      json: Record<string, unknown>;
    };
  };
}

export interface BedrockInferenceConfig {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stopSequences?: string[];
}

export interface BedrockConverseRequest {
  modelId: string;
  messages: BedrockMessage[];
  system?: { text: string }[];
  toolConfig?: { tools: BedrockToolSpec[] };
  inferenceConfig?: BedrockInferenceConfig;
}

export interface BedrockConverseResponse {
  output?: {
    message?: {
      role: string;
      content: BedrockContentBlock[];
    };
  };
  stopReason?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

// ---------------------------------------------------------------------------
// Stream event types
// ---------------------------------------------------------------------------

export interface BedrockStreamEvent {
  messageStart?: { role: string };
  contentBlockStart?: { contentBlockIndex: number; start?: { toolUse?: { toolUseId: string; name: string } } };
  contentBlockDelta?: { contentBlockIndex: number; delta: { text?: string; toolUse?: { input: string } } };
  contentBlockStop?: { contentBlockIndex: number };
  messageStop?: { stopReason: string };
  metadata?: { usage?: { inputTokens: number; outputTokens: number } };
}

// ---------------------------------------------------------------------------
// Stop reason mapping
// ---------------------------------------------------------------------------

const STOP_REASON_MAP: Record<string, string> = {
  end_turn: 'stop',
  max_tokens: 'length',
  tool_use: 'tool_calls',
  stop_sequence: 'stop',
};

export function mapStopReason(bedrockReason: string | undefined): string | null {
  if (!bedrockReason) return null;
  return STOP_REASON_MAP[bedrockReason] ?? bedrockReason;
}

// ---------------------------------------------------------------------------
// Model ID helpers
// ---------------------------------------------------------------------------

export function stripModelPrefix(model: string): string {
  return model.startsWith('bedrock/') ? model.slice('bedrock/'.length) : model;
}

// ---------------------------------------------------------------------------
// Usage helper
// ---------------------------------------------------------------------------

function toUsage(inputTokens: number, outputTokens: number): Usage {
  return {
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
  };
}

// ---------------------------------------------------------------------------
// Request transformation (OpenAI -> Bedrock Converse)
// ---------------------------------------------------------------------------

function transformMessageContent(msg: ChatCompletionMessage): BedrockContentBlock[] {
  const blocks: BedrockContentBlock[] = [];

  if (msg.content) {
    blocks.push({ text: msg.content });
  }

  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      blocks.push({
        toolUse: {
          toolUseId: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments),
        },
      });
    }
  }

  return blocks;
}

function transformToolResultMessage(msg: ChatCompletionMessage): BedrockContentBlock[] {
  return [
    {
      toolResult: {
        toolUseId: msg.tool_call_id!,
        content: [{ text: msg.content ?? '' }],
      },
    },
  ];
}

function transformTools(tools: Tool[]): BedrockToolSpec[] {
  return tools.map((tool) => ({
    toolSpec: {
      name: tool.function.name,
      description: tool.function.description,
      inputSchema: {
        json: tool.function.parameters ?? {},
      },
    },
  }));
}

function buildInferenceConfig(request: ChatCompletionRequest): BedrockInferenceConfig | undefined {
  const config: BedrockInferenceConfig = {};

  if (request.temperature !== undefined) {
    config.temperature = request.temperature;
  }
  if (request.max_tokens !== undefined) {
    config.maxTokens = request.max_tokens;
  }
  if (request.top_p !== undefined) {
    config.topP = request.top_p;
  }
  if (request.stop !== undefined) {
    config.stopSequences = Array.isArray(request.stop) ? request.stop : [request.stop];
  }

  return Object.keys(config).length > 0 ? config : undefined;
}

export function transformRequest(request: ChatCompletionRequest, modelId: string): BedrockConverseRequest {
  const system: { text: string }[] = [];
  const messages: BedrockMessage[] = [];

  for (const msg of request.messages) {
    if (msg.role === 'system') {
      system.push({ text: msg.content ?? '' });
      continue;
    }

    const role = msg.role === 'tool' ? 'user' : (msg.role as 'user' | 'assistant');
    const content = msg.role === 'tool'
      ? transformToolResultMessage(msg)
      : transformMessageContent(msg);

    messages.push({ role, content });
  }

  const result: BedrockConverseRequest = {
    modelId,
    messages,
  };

  if (system.length > 0) {
    result.system = system;
  }

  if (request.tools && request.tools.length > 0) {
    result.toolConfig = { tools: transformTools(request.tools) };
  }

  const inferenceConfig = buildInferenceConfig(request);
  if (inferenceConfig) {
    result.inferenceConfig = inferenceConfig;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Response transformation (Bedrock Converse -> OpenAI)
// ---------------------------------------------------------------------------

export function transformResponse(
  bedrockResponse: BedrockConverseResponse,
  model: string,
): ChatCompletionResponse {
  const messageContent = bedrockResponse.output?.message?.content ?? [];

  let textContent: string | null = null;
  const toolCalls: ToolCall[] = [];

  for (const block of messageContent) {
    if (block.text) {
      textContent = (textContent ?? '') + block.text;
    }
    if (block.toolUse) {
      toolCalls.push({
        id: block.toolUse.toolUseId,
        type: 'function',
        function: {
          name: block.toolUse.name,
          arguments: JSON.stringify(block.toolUse.input),
        },
      });
    }
  }

  const now = Date.now();
  const usage = toUsage(
    bedrockResponse.usage?.inputTokens ?? 0,
    bedrockResponse.usage?.outputTokens ?? 0,
  );

  return {
    id: `chatcmpl-${now}`,
    object: 'chat.completion',
    created: Math.floor(now / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: textContent,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: mapStopReason(bedrockResponse.stopReason),
      },
    ],
    usage,
  };
}

// ---------------------------------------------------------------------------
// Stream transformation (Bedrock stream events -> OpenAI chunks)
// ---------------------------------------------------------------------------

function makeChunk(
  streamId: string,
  model: string,
  delta: ChatCompletionChunkDelta,
  finishReason: string | null,
  usage?: Usage,
): ChatCompletionChunk {
  return {
    id: streamId,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(usage ? { usage } : {}),
  };
}

export function transformStreamEvent(
  event: BedrockStreamEvent,
  model: string,
  streamId: string,
): ChatCompletionChunk | null {
  if (event.messageStart) {
    return makeChunk(streamId, model, { role: 'assistant' }, null);
  }

  if (event.contentBlockStart?.start?.toolUse) {
    const toolUse = event.contentBlockStart.start.toolUse;
    return makeChunk(streamId, model, {
      tool_calls: [{
        id: toolUse.toolUseId,
        type: 'function' as const,
        function: { name: toolUse.name, arguments: '' },
      }],
    }, null);
  }

  if (event.contentBlockDelta) {
    const delta = event.contentBlockDelta.delta;
    if (delta.text !== undefined) {
      return makeChunk(streamId, model, { content: delta.text }, null);
    }
    if (delta.toolUse) {
      return makeChunk(streamId, model, {
        tool_calls: [{ function: { name: '', arguments: delta.toolUse.input } }],
      }, null);
    }
  }

  if (event.messageStop) {
    return makeChunk(streamId, model, {}, mapStopReason(event.messageStop.stopReason));
  }

  if (event.metadata?.usage) {
    const usage = toUsage(event.metadata.usage.inputTokens, event.metadata.usage.outputTokens);
    return makeChunk(streamId, model, {}, null, usage);
  }

  return null;
}
