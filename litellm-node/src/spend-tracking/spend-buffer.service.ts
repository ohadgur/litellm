import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SpendLogEntry } from './types/spend-log';

const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_THRESHOLD = 100;

@Injectable()
export class SpendBufferService implements OnModuleDestroy {
  private readonly logger = new Logger(SpendBufferService.name);
  private buffer: SpendLogEntry[] = [];
  private flushPromise: Promise<void> | null = null;
  private readonly flushTimer: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  add(entry: SpendLogEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length >= FLUSH_THRESHOLD) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    // Guard against concurrent flushes (timer + threshold can race)
    if (this.flushPromise) {
      return this.flushPromise;
    }

    if (this.buffer.length === 0) {
      return;
    }

    const entries = this.buffer;
    this.buffer = [];

    this.flushPromise = this.doFlush(entries);
    try {
      await this.flushPromise;
    } finally {
      this.flushPromise = null;
    }
  }

  private async doFlush(entries: SpendLogEntry[]): Promise<void> {
    try {
      await this.prisma.liteLLM_SpendLogs.createMany({ data: entries });
      this.logger.debug(`Flushed ${entries.length} spend log entries`);
    } catch (error) {
      this.logger.error(
        `Failed to flush ${entries.length} spend log entries: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Discard entries on error to avoid memory buildup
    }
  }

  get bufferSize(): number {
    return this.buffer.length;
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.flushTimer);
    await this.flush();
  }
}
