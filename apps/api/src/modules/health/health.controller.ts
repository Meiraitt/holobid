import { Controller, Get } from '@nestjs/common';

import type { LivenessResponse, ReadinessResponse } from '@holobid/contracts';

import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  live(): LivenessResponse {
    return this.health.getLiveness();
  }

  @Get('ready')
  ready(): Promise<ReadinessResponse> {
    return this.health.getReadiness();
  }
}
