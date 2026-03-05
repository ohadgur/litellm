import { Injectable, Logger } from '@nestjs/common';
import { Response } from 'express';
import { ChatCompletionChunk } from './types';

/**
 * Writes SSE-formatted streaming chat completion chunks to an HTTP response.
 */
@Injectable()
export class StreamingService {
  private readonly logger = new Logger(StreamingService.name);

  /**
   * Consumes an async iterable of ChatCompletionChunk objects and writes
   * them as Server-Sent Events to the Express response.
   *
   * Sets the required SSE headers, handles client disconnects, and
   * sends an error event if the stream throws.
   */
  async streamToSSE(
    stream: AsyncIterable<ChatCompletionChunk>,
    res: Response,
  ): Promise<void> {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Track client disconnect
    let clientDisconnected = false;
    const onClose = (): void => {
      clientDisconnected = true;
    };
    res.on('close', onClose);

    try {
      for await (const chunk of stream) {
        if (clientDisconnected) {
          this.logger.debug('Client disconnected, stopping stream');
          break;
        }

        const data = `data: ${JSON.stringify(chunk)}\n\n`;
        const canContinue = res.write(data);

        // Handle backpressure: wait for drain if the write buffer is full
        if (!canContinue && !clientDisconnected) {
          await new Promise<void>((resolve) => res.once('drain', resolve));
        }
      }

      // Send the terminal [DONE] message
      if (!clientDisconnected) {
        res.write('data: [DONE]\n\n');
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Internal streaming error';
      this.logger.error('Error during streaming', error instanceof Error ? error.stack : error);

      if (!clientDisconnected) {
        const errorChunk = {
          error: { message: errorMessage, type: 'server_error' },
        };
        res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
      }
    } finally {
      res.removeListener('close', onClose);
      if (!clientDisconnected) {
        res.end();
      }
    }
  }
}
