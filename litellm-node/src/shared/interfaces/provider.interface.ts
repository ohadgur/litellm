import { ChatCompletionRequest, ChatCompletionResponse, ChatCompletionChunk } from '../dto/chat-completion.dto';
import { EmbeddingRequest, EmbeddingResponse } from '../dto/embedding.dto';
import { Deployment, ModelInfo } from '../types/deployment';

export interface ProviderRequest {
  deployment: Deployment;
  body: ChatCompletionRequest;
  headers?: Record<string, string>;
}

export interface LlmProvider {
  readonly providerName: string;
  chatCompletion(request: ProviderRequest): Promise<ChatCompletionResponse>;
  chatCompletionStream(request: ProviderRequest): AsyncIterable<ChatCompletionChunk>;
  embedding?(request: EmbeddingRequest): Promise<EmbeddingResponse>;
  listModels?(): Promise<ModelInfo[]>;
}
