import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';

import { AuditService } from './audit.service';
import { AuditAnchorRepository } from './audit-anchor.repository';
import { AuditChainService } from './audit-chain.service';
import { AuditCrypto } from './audit-crypto.service';
import { AuditProtocolService } from './audit-protocol.service';
import { AuditSourceRepository } from './audit-source.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    AuditCrypto,
    AuditChainService,
    AuditAnchorRepository,
    AuditSourceRepository,
    AuditService,
    AuditProtocolService,
  ],
  exports: [AuditCrypto, AuditService, AuditProtocolService, AuditAnchorRepository],
})
export class AuditModule {}
