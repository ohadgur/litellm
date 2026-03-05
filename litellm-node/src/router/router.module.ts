import { Module } from '@nestjs/common';

import { CooldownService } from './cooldown.service';
import { DeploymentSelectorService } from './deployment-selector.service';
import { FallbackService } from './fallback.service';
import { RetryService } from './retry.service';
import { RouterService } from './router.service';

@Module({
  providers: [
    CooldownService,
    DeploymentSelectorService,
    FallbackService,
    RetryService,
    RouterService,
  ],
  exports: [RouterService, CooldownService, FallbackService, RetryService],
})
export class RouterModule {}
