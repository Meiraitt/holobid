import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../../database/database.module';
import { UsersModule } from '../users/users.module';
import { WalletPersistenceModule } from '../wallets/wallet-persistence.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { AccessTokenService } from './access-token.service';
import { AccessTokenGuard } from './access-token.guard';
import { AuthRateLimiter } from './auth-rate-limiter';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { SessionsRepository } from './sessions.repository';
import { SessionsService } from './sessions.service';
import { SessionRevocationEvents } from './session-revocation.events';
import { AuthCsrfGuard } from './auth-csrf.guard';
import { AuthCookiesService } from './auth-cookies.service';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [DatabaseModule, UsersModule, WalletPersistenceModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, AccessTokenService, AccessTokenGuard, AuthRateLimiter, AuthRateLimitGuard, SessionsRepository, SessionsService, SessionRevocationEvents, AuthCsrfGuard, AuthCookiesService, RolesGuard],
  exports: [AccessTokenGuard, AccessTokenService, SessionsService, SessionRevocationEvents, RolesGuard],
})
export class AuthModule {}
