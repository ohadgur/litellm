/**
 * Transforms between OpenAI chat-completion format and the Anthropic
 * Messages API format.
 *
 * Reference: https://docs.anthropic.com/claude/reference/messages_post
 */

import {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  OpenAIMessage,
  OpenAIToolCall,
  OpenAIToolParam,
  OpenAIUsage,
  OpenAIContentBlock,
} from '../types/llm-provider.interface';

// ---------------------------------------------------------------------------
// Anthropic request / response shapes (only the subset we need)
// ---------------------------------------------------------------------------

export interface AnthropicSystemContent {
  type: 'text';
  text: string;
}

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

export interface AnthropicImageBlock {
  type: 'image';
  source: {
    type: 'base64' | 'url';
    media_type?: string;
    data?: string;
    url?: string;
  };
}

export interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | AnthropicImageBlock;

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  system?: string | AnthropicSystemContent[];
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
  tools?: AnthropicTool[];
}

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string | null;
  usage: AnthropicUsage;
}

// ---------------------------------------------------------------------------
// Anthropic SSE event types
// ---------------------------------------------------------------------------

export interface AnthropicMessageStartEvent {
  type: 'message_start';
  message: {
    id: string;
    model: string;
    usage: { input_tokens: number; output_tokens: number };
  };
}

export interface AnthropicContentBlockStartEvent {
  type: 'content_block_start';
  index: number;
  content_block: AnthropicContentBlock;
}

export interface AnthropicContentBlockDeltaEvent {
  type: 'content_block_delta';
  index: number;
  delta:
    | { type: 'text_delta'; text: string }
    | { type: 'input_json_delta'; partial_json: string };
}

export interface AnthropicContentBlockStopEvent {
  type: 'content_block_stop';
  index: number;
}

export interface AnthropicMessageDeltaEvent {
  type: 'message_delta';
  delta: { stop_reason: string | null };
  usage?: { output_tokens: number };
}

export interface AnthropicMessageStopEvent {
  type: 'message_stop';
}

export type AnthropicStreamEvent =
  | AnthropicMessageStartEvent
  | AnthropicContentBlockStartEvent
  | AnthropicContentBlockDeltaEvent
  | AnthropicContentBlockStopEvent
  | AnthropicMessageDeltaEvent
  | AnthropicMessageStopEvent;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_TOKENS = 4096;

const STOP_REASON_MAP: Record<string, string> = {
  end_turn: 'stop',
  max_tokens: 'length',
  tool_use: 'tool_calls',
  stop_sequence: 'stop',
};

// ---------------------------------------------------------------------------
// Request transformation  (OpenAI -> Anthropic)
// ---------------------------------------------------------------------------

/**
 * Strip a provider prefix such as "anthropic/" from a model name.
 */
export function stripModelPrefix(model: string): string {
  if (model.startsWith('anthropic/')) {
    return model.slice('anthropic/'.length);
  }
  return model;
}

/**
 * Extract system messages from the messages array and return them
 * separately as Anthropic system content.  The original array is
 * *not* mutated -- a filtered copy is returned.
 */
export function extractSystemMessages(
  messages: OpenAIMessage[],
): { system: string | AnthropicSystemContent[] | undefined; filtered: OpenAIMessage[] } {
  const systemTexts: string[] = [];
  const filtered: OpenAIMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      if (typeof msg.content === 'string') {
        if (msg.content.length > 0) {
          systemTexts.push(msg.content);
        }
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            systemTexts.push(block.text);
          }
        }
      }
    } else {
      filtered.push(msg);
    }
  }

  if (systemTexts.length === 0) {
    return { system: undefined, filtered };
  }
  if (systemTexts.length === 1) {
    return { system: systemTexts[0], filtered };
  }
  return {
    system: systemTexts.map((t) => ({ type: 'text' as const, text: t })),
    filtered,
  };
}

/**
 * Convert a single OpenAI content block to an Anthropic content block.
 */
function convertContentBlock(block: OpenAIContentBlock): AnthropicContentBlock {
  if (block.type === 'text') {
    return { type: 'text', text: block.text ?? '' };
  }
  if (block.type === 'image_url' && block.image_url) {
    const url = block.image_url.url;
    // data URI -> base64
    const dataUriMatch = url.match(/^data:(.*?);base64,(.*)$/);
    if (dataUriMatch) {
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: dataUriMatch[1],
          data: dataUriMatch[2],
        },
      };
    }
    return {
      type: 'image',
      source: { type: 'url', url },
    };
  }
  // Fallback: treat as text
  return { type: 'text', text: '' };
}

/**
 * Convert OpenAI messages into Anthropic messages.
 *
 * - `assistant` messages with `tool_calls` become content arrays of `tool_use` blocks.
 * - `tool` role messages become `user` messages with `tool_result` blocks.
 * - Adjacent `user` / `tool_result` messages are merged so that Anthropic
 *   receives strictly alternating user/assistant turns.
 */
export function convertMessages(messages: OpenAIMessage[]): AnthropicMessage[] {
  const raw: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'assistant') {
      const contentBlocks: AnthropicContentBlock[] = [];

      // Textual content
      if (typeof msg.content === 'string' && msg.content.length > 0) {
        contentBlocks.push({ type: 'text', text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const b of msg.content) {
          contentBlocks.push(convertContentBlock(b));
        }
      }

      // Tool calls -> tool_use blocks
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let parsedArgs: Record<string, unknown>;
          try {
            parsedArgs = JSON.parse(tc.function.arguments);
          } catch {
            parsedArgs = {};
          }
          contentBlocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: parsedArgs,
          });
        }
      }

      if (contentBlocks.length > 0) {
        raw.push({ role: 'assistant', content: contentBlocks });
      } else {
        raw.push({ role: 'assistant', content: (msg.content as string) ?? '' });
      }
    } else if (msg.role === 'tool') {
      // Tool results become user messages with tool_result content
      const toolResult: AnthropicToolResultBlock = {
        type: 'tool_result',
        tool_use_id: msg.tool_call_id ?? '',
        content: typeof msg.content === 'string' ? msg.content : '',
      };
      raw.push({ role: 'user', content: [toolResult] });
    } else if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        raw.push({ role: 'user', content: msg.content });
      } else if (Array.isArray(msg.content)) {
        const blocks: AnthropicContentBlock[] = msg.content.map(convertContentBlock);
        raw.push({ role: 'user', content: blocks });
      } else {
        raw.push({ role: 'user', content: '' });
      }
    }
  }

  // Merge consecutive same-role messages (Anthropic requires alternating roles).
  return mergeConsecutiveRoles(raw);
}

/**
 * Anthropic requires strictly alternating user / assistant turns.
 * Merge consecutive messages of the same role into one.
 */
function mergeConsecutiveRoles(messages: AnthropicMessage[]): AnthropicMessage[] {
  const merged: AnthropicMessage[] = [];

  for (const msg of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === msg.role) {
      // Merge content into the previous message
      const prevBlocks = toContentArray(last.content);
      const curBlocks = toContentArray(msg.content);
      last.content = [...prevBlocks, ...curBlocks];
    } else {
      merged.push({ ...msg });
    }
  }
  return merged;
}

function toContentArray(content: string | AnthropicContentBlock[]): AnthropicContentBlock[] {
  if (typeof content === 'string') {
    return content.length > 0 ? [{ type: 'text', text: content }] : [];
  }
  return content;
}

/**
 * Convert OpenAI tools to Anthropic tools format.
 */
export function convertTools(tools: OpenAIToolParam[]): AnthropicTool[] {
  return tools.map((t) => {
    const result: AnthropicTool = {
      name: t.function.name,
      input_schema: t.function.parameters ?? { type: 'object', properties: {} },
    };
    if (t.function.description) {
      result.description = t.function.description;
    }
    return result;
  });
}

/**
 * Build a full Anthropic API request from an OpenAI-format request.
 */
export function transformRequest(
  request: ChatCompletionRequest,
  modelName: string,
): AnthropicRequest {
  const { system, filtered } = extractSystemMessages(request.messages);
  const anthropicMessages = convertMessages(filtered);

  const body: AnthropicRequest = {
    model: modelName,
    messages: anthropicMessages,
    max_tokens: request.max_tokens ?? DEFAULT_MAX_TOKENS,
  };

  if (system !== undefined) {
    body.system = system;
  }
  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }
  if (request.top_p !== undefined) {
    body.top_p = request.top_p;
  }
  if (request.stop !== undefined) {
    body.stop_sequences = Array.isArray(request.stop) ? request.stop : [request.stop];
  }
  if (request.stream) {
    body.stream = true;
  }
  if (request.tools && request.tools.length > 0) {
    body.tools = convertTools(request.tools);
  }

  return body;
}

// ---------------------------------------------------------------------------
// Response transformation  (Anthropic -> OpenAI)
// ---------------------------------------------------------------------------

export function mapStopReason(reason: string | null): string | null {
  if (reason === null) return null;
  return STOP_REASON_MAP[reason] ?? reason;
}

function mapUsage(usage: AnthropicUsage): OpenAIUsage {
  return {
    prompt_tokens: usage.input_tokens,
    completion_tokens: usage.output_tokens,
    total_tokens: usage.input_tokens + usage.output_tokens,
  };
}

/**
 * Convert an Anthropic Messages API response to OpenAI chat completion format.
 */
export function transformResponse(
  response: AnthropicResponse,
  model: string,
): ChatCompletionResponse {
  let textContent: string | null = null;
  const toolCalls: OpenAIToolCall[] = [];

  for (const block of response.content) {
    if (block.type === 'text') {
      textContent = (textContent ?? '') + (block as AnthropicTextBlock).text;
    } else if (block.type === 'tool_use') {
      const tu = block as AnthropicToolUseBlock;
      toolCalls.push({
        id: tu.id,
        type: 'function',
        function: {
          name: tu.name,
          arguments: JSON.stringify(tu.input),
        },
      });
    }
  }

  return {
    id: `chatcmpl-${response.id}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: textContent,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: mapStopReason(response.stop_reason),
      },
    ],
    usage: mapUsage(response.usage),
  };
}

// ---------------------------------------------------------------------------
// Stream transformation  (Anthropic SSE -> OpenAI SSE chunks)
// ---------------------------------------------------------------------------

/**
 * State machine that tracks the streaming session so that each Anthropic
 * SSE event can be mapped to the right OpenAI chunk.
 */
export class StreamTransformer {
  private messageId = '';
  private model = '';
  /** Maps content-block index -> tool info while building tool_use deltas. */
  private activeToolBlocks = new Map<number, { id: string; name: string }>();

  /**
   * Process a single Anthropic SSE event and return zero or one OpenAI chunk.
   */
  transform(event: AnthropicStreamEvent): ChatCompletionChunk | null {
    switch (event.type) {
      case 'message_start':
        this.messageId = event.message.id;
        this.model = event.message.model;
        return null; // no OpenAI chunk needed

      case 'content_block_start':
        if (event.content_block.type === 'tool_use') {
          const tu = event.content_block as AnthropicToolUseBlock;
          this.activeToolBlocks.set(event.index, { id: tu.id, name: tu.name });
          return this.makeChunk({
            tool_calls: [
              {
                id: tu.id,
                type: 'function' as const,
                function: { name: tu.name, arguments: '' },
              },
            ],
          });
        }
        return null;

      case 'content_block_delta':
        if (event.delta.type === 'text_delta') {
          return this.makeChunk({ content: event.delta.text });
        }
        if (event.delta.type === 'input_json_delta') {
          const tool = this.activeToolBlocks.get(event.index);
          if (tool) {
            return this.makeChunk({
              tool_calls: [
                {
                  id: tool.id,
                  type: 'function' as const,
                  function: { name: tool.name, arguments: event.delta.partial_json },
                },
              ],
            });
          }
        }
        return null;

      case 'content_block_stop':
        return null;

      case 'message_delta':
        return this.makeChunk(
          {},
          mapStopReason(event.delta.stop_reason),
          event.usage
            ? {
                prompt_tokens: 0,
                completion_tokens: event.usage.output_tokens,
                total_tokens: event.usage.output_tokens,
              }
            : undefined,
        );

      case 'message_stop':
        return null;

      default:
        return null;
    }
  }

  private makeChunk(
    delta: ChatCompletionChunk['choices'][0]['delta'],
    finishReason: string | null = null,
    usage?: OpenAIUsage,
  ): ChatCompletionChunk {
    return {
      id: `chatcmpl-${this.messageId}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: this.model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
      ...(usage ? { usage } : {}),
    };
  }
}
