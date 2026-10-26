import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../../database/database.module';
import { UsersModule } from '../users/users.module';
import { WalletsModule } from '../wallets/wallets.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { AccessTokenService } from './access-token.service';
import { AccessTokenGuard } from './access-token.guard';
import { AuthRateLimiter } from './auth-rate-limiter';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';

@Module({
  imports: [DatabaseModule, UsersModule, WalletsModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, AccessTokenService, AccessTokenGuard, AuthRateLimiter, AuthRateLimitGuard],
  exports: [AccessTokenGuard, AccessTokenService],
})
export class AuthModule {}
