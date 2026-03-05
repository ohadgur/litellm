import { Module } from '@nestjs/common';
import { AzureOpenAIProvider } from './azure-openai.provider';

@Module({
  providers: [AzureOpenAIProvider],
  exports: [AzureOpenAIProvider],
})
export class AzureOpenAIModule {}
