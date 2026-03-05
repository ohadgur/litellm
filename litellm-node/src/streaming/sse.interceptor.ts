import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export const SSE_PASSTHROUGH = Symbol('SSE_PASSTHROUGH');
export const SSE_RESPONSE = Symbol('SSE_RESPONSE');

/**
 * NestJS interceptor that detects `stream: true` in the request body.
 *
 * When streaming is requested the interceptor marks the request so the
 * controller can write SSE directly to the raw Express Response, bypassing
 * the default NestJS response serialization pipeline.
 */
@Injectable()
export class SseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ body?: { stream?: boolean } }>();

    if (request.body?.stream === true) {
      // Mark the request so the controller knows it should handle SSE manually
      (request as Record<string | symbol, unknown>)[SSE_PASSTHROUGH] = true;

      // Attach the raw response to the request for easy controller access
      const response = context.switchToHttp().getResponse();
      (request as Record<string | symbol, unknown>)[SSE_RESPONSE] = response;

      // Map to undefined so NestJS does not try to serialise a return value.
      // The controller is responsible for ending the response via StreamingService.
      return next.handle().pipe(map(() => undefined));
    }

    return next.handle();
  }
}
