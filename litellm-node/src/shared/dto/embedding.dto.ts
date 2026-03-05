import { IsString, IsOptional, IsArray, IsNumber } from 'class-validator';

export class EmbeddingRequest {
  @IsString()
  model!: string;

  @IsArray()
  input!: string | string[];

  @IsOptional()
  @IsString()
  encoding_format?: string;

  @IsOptional()
  @IsNumber()
  dimensions?: number;

  @IsOptional()
  @IsString()
  user?: string;
}

export class EmbeddingData {
  object!: string;
  embedding!: number[];
  index!: number;
}

export class EmbeddingUsage {
  prompt_tokens!: number;
  total_tokens!: number;
}

export class EmbeddingResponse {
  object!: string;
  data!: EmbeddingData[];
  model!: string;
  usage!: EmbeddingUsage;
}
