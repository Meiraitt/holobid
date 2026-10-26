import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isUUID } from 'class-validator';
import type { ApiEnvironment } from '../../config/environment';
import { ApiException } from '../../common/http/api.exception';

type Position = { createdAt: Date; id: string };
@Injectable()
export class AuctionCursorService {
  private readonly key: Buffer;
  constructor(config: ConfigService<ApiEnvironment, true>) {
    const secret: string = config.get('JWT_SECRET', { infer: true }); this.key = Buffer.from(secret, 'base64url');
  }
  private signature(payload: string) { return createHmac('sha256', this.key).update(`holobid:auction-cursor:${payload}`).digest('base64url'); }
  encode(position: Position, status = 'ALL'): string {
    const payload = Buffer.from(JSON.stringify([1, 'auctions', status, position.createdAt.toISOString(), position.id])).toString('base64url');
    return `${payload}.${this.signature(payload)}`;
  }
  decode(cursor: string | undefined, status = 'ALL'): Position | undefined {
    if (!cursor) return undefined;
    try {
      if (cursor.length > 512) throw new Error();
      const [payload, mac, extra] = cursor.split('.');
      if (!payload || !mac || extra !== undefined || !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]{43}$/.test(mac)) throw new Error();
      const signature = this.signature(payload);
      if (!timingSafeEqual(Buffer.from(mac), Buffer.from(signature))) throw new Error();
      const data: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (!Array.isArray(data) || data.length !== 5 || data[0] !== 1 || data[1] !== 'auctions' || data[2] !== status ||
          typeof data[3] !== 'string' || typeof data[4] !== 'string' || !isUUID(data[4], '4')) throw new Error();
      const createdAt = new Date(data[3]); if (createdAt.toISOString() !== data[3]) throw new Error();
      return { createdAt, id: data[4] };
    } catch { throw new ApiException(400, 'VALIDATION_ERROR', 'Invalid pagination cursor.'); }
  }
}
