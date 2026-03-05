export interface SpendLog {
  requestId: string;
  callType: string;
  apiKey: string;
  spend: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  startTime: Date;
  endTime: Date;
  completionStartTime?: Date;
  model: string;
  modelId?: string;
  modelGroup?: string;
  apiBase?: string;
  user?: string;
  metadata?: Record<string, unknown>;
  cacheHit?: string;
  cacheKey?: string;
  requestTags?: string[];
  teamId?: string;
  endUser?: string;
}
