import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ChatCompletionMessage,
  ToolCall,
  Tool,
} from '../../shared/types';

/**
 * Gemini content part types used during request/response transformation.
 */
export interface GeminiTextPart {
  text: string;
}

export interface GeminiFunctionCallPart {
  functionCall: {
    name: string;
    args: Record<string, unknown>;
  };
}

export interface GeminiFunctionResponsePart {
  functionResponse: {
    name: string;
    response: Record<string, unknown>;
  };
}

export type GeminiPart =
  | GeminiTextPart
  | GeminiFunctionCallPart
  | GeminiFunctionResponsePart;

export interface GeminiContent {
  role: string;
  parts: GeminiPart[];
}

export interface GeminiGenerationConfig {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  stopSequences?: string[];
}

export interface GeminiFunctionDeclaration {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface GeminiTool {
  functionDeclarations: GeminiFunctionDeclaration[];
}

export interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: { parts: GeminiTextPart[] };
  generationConfig?: GeminiGenerationConfig;
  tools?: GeminiTool[];
}

/**
 * Raw Gemini API response shape (subset of fields we use).
 */
export interface GeminiCandidate {
  content?: {
    parts?: GeminiPart[];
    role?: string;
  };
  finishReason?: string;
}

export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

export interface GeminiResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VERTEX_PREFIX = 'vertex_ai/';

export function stripModelPrefix(model: string): string {
  if (model.startsWith(VERTEX_PREFIX)) {
    return model.slice(VERTEX_PREFIX.length);
  }
  return model;
}

const ROLE_MAP_TO_GEMINI: Record<string, string> = {
  assistant: 'model',
  user: 'user',
};

const FINISH_REASON_MAP: Record<string, string> = {
  STOP: 'stop',
  MAX_TOKENS: 'length',
  SAFETY: 'content_filter',
};

function mapRoleToGemini(role: string): string {
  return ROLE_MAP_TO_GEMINI[role] ?? role;
}

function mapFinishReason(reason: string | undefined): string | null {
  if (!reason) return null;
  return FINISH_REASON_MAP[reason] ?? reason.toLowerCase();
}

function messageToParts(message: ChatCompletionMessage): GeminiPart[] {
  const parts: GeminiPart[] = [];

  // Assistant messages with tool_calls become functionCall parts
  if (message.tool_calls && message.tool_calls.length > 0) {
    for (const tc of message.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        // keep empty args on parse failure
      }
      parts.push({
        functionCall: { name: tc.function.name, args },
      });
    }
    // Also include text content if present alongside tool_calls
    if (message.content) {
      parts.push({ text: message.content });
    }
    return parts;
  }

  // Tool role messages become functionResponse parts
  if (message.role === 'tool') {
    let response: Record<string, unknown> = {};
    try {
      response = JSON.parse(message.content ?? '{}');
    } catch {
      response = { result: message.content };
    }
    parts.push({
      functionResponse: {
        name: message.name ?? message.tool_call_id ?? 'unknown',
        response,
      },
    });
    return parts;
  }

  // Default: text part
  if (message.content !== null && message.content !== undefined) {
    parts.push({ text: message.content });
  }

  return parts;
}

// ---------------------------------------------------------------------------
// Request transform (OpenAI -> Gemini)
// ---------------------------------------------------------------------------

export function transformRequest(body: ChatCompletionRequest): GeminiRequest {
  const result: GeminiRequest = { contents: [] };

  // Separate system messages and conversation messages
  const systemParts: GeminiTextPart[] = [];
  const contents: GeminiContent[] = [];

  for (const msg of body.messages) {
    if (msg.role === 'system') {
      if (msg.content) {
        systemParts.push({ text: msg.content });
      }
      continue;
    }

    const parts = messageToParts(msg);
    if (parts.length > 0) {
      contents.push({
        role: mapRoleToGemini(msg.role),
        parts,
      });
    }
  }

  result.contents = contents;

  if (systemParts.length > 0) {
    result.systemInstruction = { parts: systemParts };
  }

  // Generation config
  const genConfig: GeminiGenerationConfig = {};
  let hasGenConfig = false;

  if (body.temperature !== undefined) {
    genConfig.temperature = body.temperature;
    hasGenConfig = true;
  }
  if (body.max_tokens !== undefined) {
    genConfig.maxOutputTokens = body.max_tokens;
    hasGenConfig = true;
  }
  if (body.top_p !== undefined) {
    genConfig.topP = body.top_p;
    hasGenConfig = true;
  }
  if (body.stop !== undefined) {
    genConfig.stopSequences = Array.isArray(body.stop)
      ? body.stop
      : [body.stop];
    hasGenConfig = true;
  }

  if (hasGenConfig) {
    result.generationConfig = genConfig;
  }

  // Tools
  if (body.tools && body.tools.length > 0) {
    result.tools = [
      {
        functionDeclarations: body.tools.map((tool: Tool) => {
          const decl: GeminiFunctionDeclaration = { name: tool.function.name };
          if (tool.function.description !== undefined) {
            decl.description = tool.function.description;
          }
          if (tool.function.parameters !== undefined) {
            decl.parameters = tool.function.parameters;
          }
          return decl;
        }),
      },
    ];
  }

  return result;
}

// ---------------------------------------------------------------------------
// Response transform (Gemini -> OpenAI)
// ---------------------------------------------------------------------------

interface ExtractedParts {
  textContent: string | null;
  toolCalls: ToolCall[];
}

function extractParts(parts: GeminiPart[]): ExtractedParts {
  const texts: string[] = [];
  const toolCalls: ToolCall[] = [];
  let callIdx = 0;

  for (const part of parts) {
    if ('text' in part) {
      texts.push(part.text);
    } else if ('functionCall' in part) {
      toolCalls.push({
        id: `call_${callIdx}`,
        type: 'function',
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args ?? {}),
        },
      });
      callIdx++;
    }
  }

  return {
    textContent: texts.length > 0 ? texts.join('') : null,
    toolCalls,
  };
}

export function transformResponse(
  geminiResponse: GeminiResponse,
  model: string,
): ChatCompletionResponse {
  const candidate = geminiResponse.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const { textContent, toolCalls } = extractParts(parts);

  const message: ChatCompletionMessage = {
    role: 'assistant',
    content: textContent,
  };

  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }

  const usage = geminiResponse.usageMetadata;
  const promptTokens = usage?.promptTokenCount ?? 0;
  const completionTokens = usage?.candidatesTokenCount ?? 0;
  const now = Date.now();

  return {
    id: `chatcmpl-${now}`,
    object: 'chat.completion',
    created: Math.floor(now / 1000),
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: mapFinishReason(candidate?.finishReason),
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

// ---------------------------------------------------------------------------
// Stream transform (Gemini -> OpenAI chunk)
// ---------------------------------------------------------------------------

export function transformStreamChunk(
  geminiResponse: GeminiResponse,
  model: string,
  chunkIndex: number,
): ChatCompletionChunk {
  const candidate = geminiResponse.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const { textContent, toolCalls } = extractParts(parts);

  const delta: ChatCompletionChunk['choices'][0]['delta'] = {};

  if (chunkIndex === 0) {
    delta.role = 'assistant';
  }

  if (textContent !== null) {
    delta.content = textContent;
  }

  if (toolCalls.length > 0) {
    delta.tool_calls = toolCalls;
  }

  const now = Date.now();

  return {
    id: `chatcmpl-${now}`,
    object: 'chat.completion.chunk',
    created: Math.floor(now / 1000),
    model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: mapFinishReason(candidate?.finishReason),
      },
    ],
  };
}
