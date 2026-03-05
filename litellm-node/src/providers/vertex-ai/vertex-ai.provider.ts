import { Injectable } from '@nestjs/common';
import {
  VertexAI,
  GenerativeModel,
  VertexInit,
  GenerateContentRequest,
} from '@google-cloud/vertexai';
import {
  LlmProvider,
  ProviderRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  Deployment,
} from '../../shared/types';
import { ProviderError, ProviderErrorType } from '../../shared/types/errors';
import {
  stripModelPrefix,
  transformRequest,
  transformResponse,
  transformStreamChunk,
  GeminiResponse,
} from './vertex-ai.transformer';

const DEFAULT_LOCATION = 'us-central1';

@Injectable()
export class VertexAIProvider implements LlmProvider {
  readonly providerName = 'vertex_ai';

  async chatCompletion(
    request: ProviderRequest,
  ): Promise<ChatCompletionResponse> {
    const { deployment, body } = request;
    const modelName = stripModelPrefix(deployment.modelName);
    const model = this.getModel(deployment, modelName);
    const geminiRequest = transformRequest(body);

    try {
      const sdkRequest = geminiRequest as unknown as GenerateContentRequest;
      const result = await model.generateContent(sdkRequest);
      const geminiResponse = result.response as unknown as GeminiResponse;
      return transformResponse(geminiResponse, modelName);
    } catch (error) {
      throw this.mapError(error, deployment);
    }
  }

  async *chatCompletionStream(
    request: ProviderRequest,
  ): AsyncIterable<ChatCompletionChunk> {
    const { deployment, body } = request;
    const modelName = stripModelPrefix(deployment.modelName);
    const model = this.getModel(deployment, modelName);
    const geminiRequest = transformRequest(body);

    try {
      const sdkRequest = geminiRequest as unknown as GenerateContentRequest;
      const streamResult =
        await model.generateContentStream(sdkRequest);

      let chunkIndex = 0;
      for await (const item of streamResult.stream) {
        const geminiChunk = item as unknown as GeminiResponse;
        yield transformStreamChunk(geminiChunk, modelName, chunkIndex);
        chunkIndex++;
      }
    } catch (error) {
      throw this.mapError(error, deployment);
    }
  }

  /**
   * Creates a VertexAI client and returns a GenerativeModel. Extracted
   * as a protected method so tests can override it without hitting GCP.
   */
  protected getModel(
    deployment: Deployment,
    modelName: string,
  ): GenerativeModel {
    const project = deployment.vertexProject;
    if (!project) {
      throw new ProviderError(
        'vertexProject is required for Vertex AI deployments',
        400,
        this.providerName,
        ProviderErrorType.InvalidRequestError,
      );
    }

    const location = deployment.vertexLocation ?? DEFAULT_LOCATION;

    const clientOptions: VertexInit = {
      project,
      location,
    };

    // Support explicit service account credentials via JSON string
    if (deployment.vertexCredentials) {
      try {
        clientOptions.googleAuthOptions = {
          credentials: JSON.parse(deployment.vertexCredentials),
        };
      } catch {
        throw new ProviderError(
          'Invalid vertexCredentials JSON',
          400,
          this.providerName,
          ProviderErrorType.InvalidRequestError,
        );
      }
    }

    const vertexAI = this.createVertexClient(clientOptions);
    return vertexAI.getGenerativeModel({ model: modelName });
  }

  /**
   * Wraps the VertexAI constructor for testability.
   */
  protected createVertexClient(options: VertexInit): VertexAI {
    return new VertexAI(options);
  }

  private mapError(error: unknown, deployment: Deployment): ProviderError {
    if (error instanceof ProviderError) {
      return error;
    }

    const err = error as { status?: number; statusCode?: number; message?: string };
    const status = err.status ?? err.statusCode ?? 500;
    const message = err.message ?? `Vertex AI error (HTTP ${status})`;

    const typeMap: Record<number, ProviderErrorType> = {
      401: ProviderErrorType.AuthenticationError,
      403: ProviderErrorType.AuthenticationError,
      404: ProviderErrorType.NotFoundError,
      429: ProviderErrorType.RateLimitError,
      400: ProviderErrorType.InvalidRequestError,
      500: ProviderErrorType.ServerError,
      503: ProviderErrorType.ServiceUnavailable,
    };

    return new ProviderError(
      message,
      status,
      this.providerName,
      typeMap[status] ?? ProviderErrorType.Unknown,
      error,
    );
  }
}
