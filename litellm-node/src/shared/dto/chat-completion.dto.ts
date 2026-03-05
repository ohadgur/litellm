import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsArray,
  ValidateNested,
  IsEnum,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

// ---------- Sub-types ----------

export class FunctionCall {
  @IsString()
  name!: string;

  @IsString()
  arguments!: string;
}

export class ToolCall {
  @IsString()
  id!: string;

  @IsString()
  type!: string;

  @ValidateNested()
  @Type(() => FunctionCall)
  function!: FunctionCall;
}

export enum MessageRole {
  System = 'system',
  User = 'user',
  Assistant = 'assistant',
  Tool = 'tool',
  Function = 'function',
}

export class Message {
  @IsEnum(MessageRole)
  role!: MessageRole;

  @IsOptional()
  @IsString()
  content?: string | null;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ToolCall)
  tool_calls?: ToolCall[];

  @IsOptional()
  @IsString()
  tool_call_id?: string;
}

export class Usage {
  prompt_tokens!: number;
  completion_tokens!: number;
  total_tokens!: number;
}

export class Choice {
  index!: number;
  message!: Message;
  finish_reason!: string | null;
}

// ---------- Request ----------

export class ChatCompletionRequest {
  @IsString()
  model!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Message)
  messages!: Message[];

  @IsOptional()
  @IsBoolean()
  stream?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  max_tokens?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  top_p?: number;

  @IsOptional()
  @IsNumber()
  frequency_penalty?: number;

  @IsOptional()
  @IsNumber()
  presence_penalty?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  stop?: string[];

  @IsOptional()
  @IsArray()
  tools?: Record<string, unknown>[];

  @IsOptional()
  tool_choice?: string | Record<string, unknown>;

  @IsOptional()
  @IsString()
  user?: string;

  @IsOptional()
  @IsNumber()
  seed?: number;

  @IsOptional()
  response_format?: Record<string, unknown>;
}

// ---------- Response ----------

export class ChatCompletionResponse {
  id!: string;
  object!: string;
  created!: number;
  model!: string;
  choices!: Choice[];
  usage!: Usage;
}

// ---------- Streaming ----------

export class DeltaContent {
  role?: string;
  content?: string | null;
  tool_calls?: ToolCall[];
}

export class StreamChoice {
  index!: number;
  delta!: DeltaContent;
  finish_reason!: string | null;
}

export class ChatCompletionChunk {
  id!: string;
  object!: string;
  created!: number;
  model!: string;
  choices!: StreamChoice[];
  usage?: Usage | null;
}
