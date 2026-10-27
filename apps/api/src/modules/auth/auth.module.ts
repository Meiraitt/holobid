import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { DatabaseModule } from '../../database/database.module';
import { UsersModule } from '../users/users.module';
import { WalletPersistenceModule } from '../wallets/wallet-persistence.module';

import { AccessTokenGuard } from './access-token.guard';
import { AccessTokenService } from './access-token.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthCookiesService } from './auth-cookies.service';
import { AuthCsrfGuard } from './auth-csrf.guard';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { AuthRateLimiter } from './auth-rate-limiter';
import { PasswordService } from './password.service';
import { RolesGuard } from './roles.guard';
import { SessionRevocationEvents } from './session-revocation.events';
import { SessionsRepository } from './sessions.repository';
import { SessionsService } from './sessions.service';

@Module({
  imports: [DatabaseModule, UsersModule, WalletPersistenceModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    AccessTokenService,
    AccessTokenGuard,
    AuthRateLimiter,
    AuthRateLimitGuard,
    SessionsRepository,
    SessionsService,
    SessionRevocationEvents,
    AuthCsrfGuard,
    AuthCookiesService,
    RolesGuard,
  ],
  exports: [
    PasswordService,
    AccessTokenGuard,
    AccessTokenService,
    SessionsService,
    SessionRevocationEvents,
    RolesGuard,
  ],
})
export class AuthModule {}
