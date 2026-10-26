import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '../../config/environment';
import { ApiException } from '../http/api.exception';

@Injectable()
export class SignedCursorService {
  private readonly key: Buffer;
  constructor(config: ConfigService<ApiEnvironment, true>) { const secret: string = config.get('JWT_SECRET', { infer: true }); this.key = Buffer.from(secret, 'base64url'); }
  private sign(payload: string) { return createHmac('sha256', this.key).update(`holobid:page:v1:${payload}`).digest('base64url'); }
  invalid(): never { throw new ApiException(400, 'VALIDATION_ERROR', 'Invalid pagination cursor.'); }
  encode(scope: string, position: string[]): string {
    const payload = Buffer.from(JSON.stringify([1, scope, position])).toString('base64url');
    return `${payload}.${this.sign(payload)}`;
  }
  decode(cursor: string | undefined, scope: string): string[] | undefined {
    if (cursor === undefined) return undefined;
    try {
      if (cursor.length > 1024) throw new Error();
      const [payload, mac, extra] = cursor.split('.');
      if (!payload || !mac || extra !== undefined || !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]{43}$/.test(mac)) throw new Error();
      if (!timingSafeEqual(Buffer.from(mac), Buffer.from(this.sign(payload)))) throw new Error();
      const data: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (!Array.isArray(data) || data.length !== 3 || data[0] !== 1 || data[1] !== scope || !Array.isArray(data[2]) ||
          data[2].length > 4 || !data[2].every((part: unknown) => typeof part === 'string' && part.length <= 128)) throw new Error();
      return data[2] as string[];
    } catch { return this.invalid(); }
  }
}
