import { Module } from '@nestjs/common';
import { VertexAIProvider } from './vertex-ai.provider';

@Module({
  providers: [VertexAIProvider],
  exports: [VertexAIProvider],
})
export class VertexAIModule {}
