import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { createHash } from 'crypto';
import { UserAPIKeyAuth } from './types/api-key-auth';

/** Shape of a row from the LiteLLM_VerificationToken table. */
interface VerificationTokenRow {
  token: string;
  key_name: string | null;
  key_alias: string | null;
  spend: number;
  max_budget: number | null;
  expires: Date | null;
  models: string[];
  user_id: string | null;
  team_id: string | null;
  organization_id: string | null;
  permissions: Record<string, unknown> | null;
  max_parallel_requests: number | null;
  metadata: Record<string, unknown> | null;
  tpm_limit: bigint | null;
  rpm_limit: bigint | null;
  blocked: boolean | null;
}

interface CacheEntry {
  value: UserAPIKeyAuth;
  expiresAt: number;
}

/**
 * Minimal abstraction over the Prisma client so the service can be tested
 * without a real database connection.
 */
export interface PrismaDelegate {
  liteLLM_VerificationToken: {
    findUnique(args: { where: { token: string } }): Promise<VerificationTokenRow | null>;
  };
}

@Injectable()
export class AuthService {
  private readonly cache = new Map<string, CacheEntry>();

  private static readonly CACHE_TTL_MS = 60_000;

  constructor(private readonly prisma: PrismaDelegate) {}

  /**
   * Hash an API key with SHA-256, matching the Python proxy's hashing scheme.
   */
  hashApiKey(apiKey: string): string {
    return createHash('sha256').update(apiKey).digest('hex');
  }

  /**
   * Validate a raw (un-hashed) API key and return the associated auth object.
   *
   * Throws:
   *  - UnauthorizedException (401) for missing, unknown, expired, or blocked keys.
   *  - ForbiddenException   (403) for budget exceeded or model not allowed.
   */
  async validateApiKey(rawKey: string, requestedModel?: string): Promise<UserAPIKeyAuth> {
    const hashedKey = this.hashApiKey(rawKey);

    // --- check cache ---
    const cached = this.cache.get(hashedKey);
    if (cached) {
      if (cached.expiresAt > Date.now()) {
        return this.checkModelAccess(cached.value, requestedModel);
      }
      this.cache.delete(hashedKey);
    }

    // --- DB lookup ---
    const row = await this.prisma.liteLLM_VerificationToken.findUnique({
      where: { token: hashedKey },
    });

    if (!row) {
      throw new UnauthorizedException('Invalid API key');
    }

    // --- blocked ---
    if (row.blocked) {
      throw new UnauthorizedException('API key is blocked');
    }

    // --- expiry ---
    if (row.expires && new Date(row.expires) < new Date()) {
      throw new UnauthorizedException('API key has expired');
    }

    // --- budget ---
    if (row.max_budget !== null && row.spend >= row.max_budget) {
      throw new ForbiddenException('Budget exceeded');
    }

    const auth: UserAPIKeyAuth = {
      token: row.token,
      keyName: row.key_name ?? undefined,
      keyAlias: row.key_alias ?? undefined,
      userId: row.user_id ?? undefined,
      teamId: row.team_id ?? undefined,
      orgId: row.organization_id ?? undefined,
      models: row.models ?? [],
      maxBudget: row.max_budget ?? undefined,
      spend: row.spend,
      tpmLimit: row.tpm_limit !== null ? Number(row.tpm_limit) : undefined,
      rpmLimit: row.rpm_limit !== null ? Number(row.rpm_limit) : undefined,
      maxParallelRequests: row.max_parallel_requests ?? undefined,
      metadata: row.metadata ?? undefined,
      permissions: row.permissions ?? undefined,
    };

    // --- populate cache ---
    this.cache.set(hashedKey, {
      value: auth,
      expiresAt: Date.now() + AuthService.CACHE_TTL_MS,
    });

    return this.checkModelAccess(auth, requestedModel);
  }

  /**
   * If the key has a restricted model list and a model was requested,
   * verify the model is allowed.
   */
  private checkModelAccess(auth: UserAPIKeyAuth, requestedModel?: string): UserAPIKeyAuth {
    if (requestedModel && auth.models.length > 0 && !auth.models.includes(requestedModel)) {
      throw new ForbiddenException(
        `Model '${requestedModel}' is not allowed for this API key`,
      );
    }
    return auth;
  }
}
