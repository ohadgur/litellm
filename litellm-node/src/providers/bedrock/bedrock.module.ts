import { Module } from '@nestjs/common';
import { BedrockProvider } from './bedrock.provider';

@Module({
  providers: [BedrockProvider],
  exports: [BedrockProvider],
})
export class BedrockModule {}
