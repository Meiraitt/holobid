import {
  BeforeApplicationShutdown,
  Injectable,
  OnApplicationBootstrap,
  ServiceUnavailableException,
} from '@nestjs/common';

import type { LivenessResponse, ReadinessResponse } from '@holobid/contracts';

import { AuditDatabaseService } from '../../database/audit-database.service';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class HealthService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private ready = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly auditDatabase: AuditDatabaseService,
  ) {}

  onApplicationBootstrap(): void {
    this.ready = true;
  }

  beforeApplicationShutdown(): void {
    this.ready = false;
  }

  getLiveness(): LivenessResponse {
    return { status: 'ok' };
  }

  async getReadiness(): Promise<ReadinessResponse> {
    if (!this.ready) {
      throw new ServiceUnavailableException();
    }

    try {
      await Promise.all([this.database.ping(), this.auditDatabase.ping()]);
    } catch {
      throw new ServiceUnavailableException();
    }

    if (!this.ready) {
      throw new ServiceUnavailableException();
    }

    return { status: 'ready' };
  }
}
