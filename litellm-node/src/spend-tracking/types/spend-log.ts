export interface SpendLogParams {
  requestId: string;
  callType:
    | 'completion'
    | 'embedding'
    | 'image_generation'
    | 'audio_transcription';
  apiKeyHash: string;
  model: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  userId?: string;
  teamId?: string;
  orgId?: string;
  startTime: Date;
  endTime: Date;
  metadata?: Record<string, unknown>;
}

export interface SpendLogEntry {
  request_id: string;
  call_type: string;
  api_key: string;
  spend: number;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  model: string;
  user?: string;
  team_id?: string;
  organization_id?: string;
  startTime: Date;
  endTime: Date;
  metadata?: Record<string, unknown>;
}

export interface ModelPricing {
  input_cost_per_token: number;
  output_cost_per_token: number;
}
