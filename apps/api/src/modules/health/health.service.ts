import { BeforeApplicationShutdown, Injectable, OnApplicationBootstrap, ServiceUnavailableException } from '@nestjs/common';
import type { LivenessResponse, ReadinessResponse } from '@holobid/contracts';

@Injectable()
export class HealthService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private ready = false;

  onApplicationBootstrap(): void {
    this.ready = true;
  }

  beforeApplicationShutdown(): void {
    this.ready = false;
  }

  getLiveness(): LivenessResponse {
    return { status: 'ok' };
  }

  getReadiness(): ReadinessResponse {
    if (!this.ready) throw new ServiceUnavailableException();
    return { status: 'ready' };
  }
}
