import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import type { AuthResponse, AuthUser } from '@holobid/contracts';
import { AuthService } from './auth.service';
import { CredentialsDto } from './credentials.dto';
import { AccessTokenGuard } from './access-token.guard';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { CurrentUser } from './auth-user';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @UseGuards(AuthRateLimitGuard)
  register(@Body() input: CredentialsDto): Promise<AuthResponse> {
    return this.auth.register(input);
  }

  @Post('login')
  @HttpCode(200)
  @UseGuards(AuthRateLimitGuard)
  login(@Body() input: CredentialsDto): Promise<AuthResponse> {
    return this.auth.login(input);
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }
}
