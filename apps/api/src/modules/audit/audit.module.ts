import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuditCrypto } from './audit-crypto.service';
import { AuditChainService } from './audit-chain.service';
import { AuditAnchorRepository } from './audit-anchor.repository';
import { AuditSourceRepository } from './audit-source.repository';
import { AuditService } from './audit.service';
import { AuditProtocolService } from './audit-protocol.service';

@Module({ imports: [DatabaseModule], providers: [AuditCrypto, AuditChainService, AuditAnchorRepository, AuditSourceRepository, AuditService, AuditProtocolService],
  exports: [AuditCrypto, AuditService, AuditProtocolService, AuditAnchorRepository] })
export class AuditModule {}
