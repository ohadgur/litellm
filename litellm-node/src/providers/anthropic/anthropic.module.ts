import { Module } from '@nestjs/common';
import { AnthropicProvider } from './anthropic.provider';

@Module({
  providers: [AnthropicProvider],
  exports: [AnthropicProvider],
})
export class AnthropicModule {}
