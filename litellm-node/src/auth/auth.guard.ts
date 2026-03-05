import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';

/**
 * NestJS guard that extracts a Bearer token from the Authorization header,
 * validates it via AuthService, and attaches the resolved UserAPIKeyAuth
 * to the request object as `request.apiKeyAuth`.
 *
 * Usage: @UseGuards(AuthGuard)
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers?.['authorization'];

    if (!authHeader) {
      throw new UnauthorizedException('Missing Authorization header');
    }

    const token = this.extractBearerToken(authHeader);
    if (!token) {
      throw new UnauthorizedException('Invalid Authorization header format. Expected: Bearer <token>');
    }

    // Optionally pick up the requested model from the body so model-access
    // checks can run at the guard level.
    const requestedModel: string | undefined = request.body?.model;

    const apiKeyAuth = await this.authService.validateApiKey(token, requestedModel);
    request.apiKeyAuth = apiKeyAuth;

    return true;
  }

  private extractBearerToken(header: string): string | undefined {
    const parts = header.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer' && parts[1]) {
      return parts[1];
    }
    return undefined;
  }
}
