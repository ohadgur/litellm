export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly providerName: string,
    public readonly errorType: ProviderErrorType,
    public readonly rawError?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export enum ProviderErrorType {
  AuthenticationError = 'authentication_error',
  RateLimitError = 'rate_limit_error',
  InvalidRequestError = 'invalid_request_error',
  NotFoundError = 'not_found_error',
  ServerError = 'server_error',
  ServiceUnavailable = 'service_unavailable',
  Timeout = 'timeout',
  Unknown = 'unknown',
}
