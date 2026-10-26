import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { isUUID } from 'class-validator';
import type { AuthUser, UserRole } from '@holobid/contracts';
import type { ApiEnvironment } from '../../config/environment';

export interface AccessClaims {
  sub: string;
  role: UserRole;
  iat: number;
  exp: number;
}

@Injectable()
export class AccessTokenService {
  private readonly key: Buffer;
  private readonly issuer = 'holobid-api';
  private readonly audience = 'holobid-web';

  constructor(private readonly jwt: JwtService, config: ConfigService<ApiEnvironment, true>) {
    const secret = config.get('JWT_SECRET', { infer: true });
    this.key = Buffer.from(secret, 'base64url');
  }

  sign(user: AuthUser): Promise<string> {
    return this.jwt.signAsync({ sub: user.id, role: user.role }, {
      secret: this.key, algorithm: 'HS256', issuer: this.issuer, audience: this.audience, expiresIn: 900,
    });
  }

  async verify(token: string): Promise<AccessClaims> {
    try {
      const claims = await this.jwt.verifyAsync<AccessClaims>(token, {
        secret: this.key, algorithms: ['HS256'], issuer: this.issuer, audience: this.audience,
      });
      if (!isUUID(claims.sub) || !['BIDDER', 'AUCTIONEER'].includes(claims.role) ||
          !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) ||
          claims.exp - claims.iat !== 900 || claims.iat > Math.floor(Date.now() / 1000)) {
        throw new Error();
      }
      return claims;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
