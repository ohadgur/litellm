import { Injectable } from '@nestjs/common';
import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  ConverseCommandInput,
  ConverseStreamCommandInput,
} from '@aws-sdk/client-bedrock-runtime';
import {
  LlmProvider,
  ProviderRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from '../../shared/types';
import { ProviderError, ProviderErrorType } from '../../shared/types/errors';
import {
  transformRequest,
  transformResponse,
  transformStreamEvent,
  stripModelPrefix,
  BedrockConverseResponse,
  BedrockStreamEvent,
} from './bedrock.transformer';

@Injectable()
export class BedrockProvider implements LlmProvider {
  readonly providerName = 'bedrock';

  async chatCompletion(request: ProviderRequest): Promise<ChatCompletionResponse> {
    const { deployment, body } = request;
    const client = this.createClient(deployment.litellmParams);
    const modelId = stripModelPrefix(body.model);

    const converseInput = transformRequest(body, modelId) as unknown as ConverseCommandInput;

    try {
      const command = new ConverseCommand(converseInput);
      const response = await client.send(command);

      return transformResponse(response as unknown as BedrockConverseResponse, modelId);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async *chatCompletionStream(request: ProviderRequest): AsyncIterable<ChatCompletionChunk> {
    const { deployment, body } = request;
    const client = this.createClient(deployment.litellmParams);
    const modelId = stripModelPrefix(body.model);

    const converseInput = transformRequest(body, modelId) as unknown as ConverseStreamCommandInput;

    let stream: AsyncIterable<BedrockStreamEvent>;
    try {
      const command = new ConverseStreamCommand(converseInput);
      const response = await client.send(command);

      if (!response.stream) {
        throw new ProviderError(
          'No stream in Bedrock response',
          500,
          this.providerName,
          ProviderErrorType.ServerError,
        );
      }

      stream = response.stream as AsyncIterable<BedrockStreamEvent>;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw this.mapError(error);
    }

    const streamId = `chatcmpl-${Date.now()}`;

    for await (const event of stream) {
      const chunk = transformStreamEvent(event, modelId, streamId);
      if (chunk) {
        yield chunk;
      }
    }
  }

  createClient(litellmParams: Record<string, unknown>): BedrockRuntimeClient {
    const region =
      (litellmParams['aws_region_name'] as string | undefined) ??
      (litellmParams['awsRegionName'] as string | undefined) ??
      process.env['AWS_REGION'] ??
      'us-east-1';

    const apiKey = litellmParams['api_key'] as string | undefined;
    const secretKey = litellmParams['aws_secret_access_key'] as string | undefined;

    const clientConfig: Record<string, unknown> = { region };

    if (apiKey && secretKey) {
      clientConfig['credentials'] = {
        accessKeyId: apiKey,
        secretAccessKey: secretKey,
      };
    } else if (apiKey) {
      clientConfig['credentials'] = {
        accessKeyId: apiKey,
        secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'] ?? '',
      };
    }
    // Otherwise, the SDK falls back to default credential chain (env vars, IAM role, etc.)

    return new BedrockRuntimeClient(clientConfig);
  }

  private mapError(error: unknown): ProviderError {
    const err = error as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
    const status = err.$metadata?.httpStatusCode ?? 500;
    const message = err.message ?? 'Bedrock API error';

    const typeMap: Record<string, ProviderErrorType> = {
      AccessDeniedException: ProviderErrorType.AuthenticationError,
      ValidationException: ProviderErrorType.InvalidRequestError,
      ResourceNotFoundException: ProviderErrorType.NotFoundError,
      ThrottlingException: ProviderErrorType.RateLimitError,
      ServiceUnavailableException: ProviderErrorType.ServiceUnavailable,
      ModelTimeoutException: ProviderErrorType.Timeout,
    };

    const errorType: ProviderErrorType =
      (err.name ? typeMap[err.name] : undefined) ?? ProviderErrorType.Unknown;

    return new ProviderError(message, status, this.providerName, errorType, error);
  }
}
