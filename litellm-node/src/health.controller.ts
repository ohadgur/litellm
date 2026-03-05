import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('ping')
  ping(): string {
    return 'pong';
  }

  @Get('internal/selftest')
  selftest(): { status: string } {
    return { status: 'ok' };
  }
}
