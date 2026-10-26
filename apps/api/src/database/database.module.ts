import { Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { AuditDatabaseService } from './audit-database.service';

@Module({
  providers: [DatabaseService, AuditDatabaseService],
  exports: [DatabaseService, AuditDatabaseService],
})
export class DatabaseModule {}
