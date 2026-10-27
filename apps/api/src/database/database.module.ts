import { Module } from '@nestjs/common';

import { AuditDatabaseService } from './audit-database.service';
import { DatabaseService } from './database.service';

@Module({
  providers: [DatabaseService, AuditDatabaseService],
  exports: [DatabaseService, AuditDatabaseService],
})
export class DatabaseModule {}
