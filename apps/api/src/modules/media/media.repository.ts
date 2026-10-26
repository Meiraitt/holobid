import { Injectable } from '@nestjs/common';
import { DatabaseService, TransactionContext } from '../../database/database.service';

export type PreparedImage = { bytes: Buffer; mimeType: string; sha256: string };

@Injectable()
export class MediaRepository {
  constructor(private readonly database: DatabaseService) {}
  find(id: string) { return this.database.client.mediaAsset.findUnique({ where: { id } }); }
  async store(image: PreparedImage, tx: TransactionContext) {
    // Concurrent imports may share bytes. Native ON CONFLICT avoids a failed transaction.
    await tx.$executeRaw`INSERT INTO "MediaAsset" ("bytes", "mimeType", "sha256", "size")
      VALUES (${image.bytes}, ${image.mimeType}, ${image.sha256}, ${image.bytes.length}) ON CONFLICT ("sha256") DO NOTHING`;
    return tx.mediaAsset.findUniqueOrThrow({ where: { sha256: image.sha256 } });
  }
}
