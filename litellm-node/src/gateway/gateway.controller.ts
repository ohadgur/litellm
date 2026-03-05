import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
  UseFilters,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { HttpExceptionFilter } from '../shared/filters/http-exception.filter';
import { ChatCompletionRequest } from '../shared/dto/chat-completion.dto';
import { EmbeddingRequest } from '../shared/dto/embedding.dto';
import { ModelListResponse, ModelObject } from '../shared/dto/models.dto';
import { StreamingService } from '../streaming/streaming.service';
import { GatewayService, ChatCompletionResponse } from './gateway.service';
import { UserAPIKeyAuth } from '../auth/types/api-key-auth';
import { ChatCompletionChunk } from '../streaming/types';

/** Extend Express Request to include the auth object set by AuthGuard. */
interface AuthenticatedRequest extends Request {
  apiKeyAuth: UserAPIKeyAuth;
}

@Controller()
@UseFilters(HttpExceptionFilter)
export class GatewayController {
  constructor(
    private readonly gatewayService: GatewayService,
    private readonly streamingService: StreamingService,
  ) {}

  @Post('v1/chat/completions')
  @UseGuards(AuthGuard)
  async chatCompletionsV1(
    @Body() body: ChatCompletionRequest,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    await this.handleChatCompletions(body, req, res);
  }

  @Post('chat/completions')
  @UseGuards(AuthGuard)
  async chatCompletions(
    @Body() body: ChatCompletionRequest,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    await this.handleChatCompletions(body, req, res);
  }

  @Post('v1/completions')
  @UseGuards(AuthGuard)
  async completionsV1(
    @Body() body: ChatCompletionRequest,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    await this.handleChatCompletions(body, req, res);
  }

  @Post('completions')
  @UseGuards(AuthGuard)
  async completions(
    @Body() body: ChatCompletionRequest,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    await this.handleChatCompletions(body, req, res);
  }

  @Post('v1/embeddings')
  @UseGuards(AuthGuard)
  async embeddingsV1(
    @Body() body: EmbeddingRequest,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    await this.handleEmbeddings(body, req, res);
  }

  @Post('embeddings')
  @UseGuards(AuthGuard)
  async embeddings(
    @Body() body: EmbeddingRequest,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    await this.handleEmbeddings(body, req, res);
  }

  @Get('v1/models')
  listModelsV1(): ModelListResponse {
    return this.gatewayService.listModels();
  }

  @Get('models')
  listModels(): ModelListResponse {
    return this.gatewayService.listModels();
  }

  @Get('v1/models/:modelId')
  getModelV1(@Param('modelId') modelId: string): ModelObject {
    return this.gatewayService.getModel(modelId);
  }

  @Get('models/:modelId')
  getModel(@Param('modelId') modelId: string): ModelObject {
    return this.gatewayService.getModel(modelId);
  }

  // ── Private helpers ──────────────────────────────────────────────

  private async handleChatCompletions(
    body: ChatCompletionRequest,
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const auth = req.apiKeyAuth;
    const stream = body.stream === true;

    const result = await this.gatewayService.processRequest({
      body,
      auth,
      stream,
    });

    if (stream) {
      await this.streamingService.streamToSSE(
        result as AsyncIterable<ChatCompletionChunk>,
        res,
      );
    } else {
      res.json(result as ChatCompletionResponse);
    }
  }

  private async handleEmbeddings(
    body: EmbeddingRequest,
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const auth = req.apiKeyAuth;
    const result = await this.gatewayService.processEmbedding(body, auth);
    res.json(result);
  }
}
