export interface UserAPIKeyAuth {
  token: string;
  keyName?: string;
  keyAlias?: string;
  userId?: string;
  teamId?: string;
  orgId?: string;
  endUserId?: string;
  models: string[];
  maxBudget?: number;
  spend: number;
  tpmLimit?: number;
  rpmLimit?: number;
  maxParallelRequests?: number;
  metadata?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
}
