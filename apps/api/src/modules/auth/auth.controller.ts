import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';

import type { AuthResponse, AuthUser } from '@holobid/contracts';

import { AccessTokenGuard, readBearer } from './access-token.guard';
import { AuthService } from './auth.service';
import { AuthCookiesService } from './auth-cookies.service';
import { AuthCsrfGuard } from './auth-csrf.guard';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { CurrentUser } from './auth-user';
import { CredentialsDto } from './credentials.dto';
import { EmptyBodyPipe } from './empty-body.pipe';
import { SessionsService } from './sessions.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    private readonly cookies: AuthCookiesService,
  ) {}

  @Post('register')
  @UseGuards(AuthCsrfGuard, AuthRateLimitGuard)
  async register(
    @Body() input: CredentialsDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const result = await this.auth.register(input);

    this.cookies.set(response, result);

    return result.response;
  }

  @Post('login')
  @HttpCode(200)
  @UseGuards(AuthCsrfGuard, AuthRateLimitGuard)
  async login(
    @Body() input: CredentialsDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const result = await this.auth.login(input);

    this.cookies.set(response, result);

    return result.response;
  }

  @Post('refresh')
  @HttpCode(200)
  @UseGuards(AuthCsrfGuard)
  async refresh(
    @Body(EmptyBodyPipe) _body: Record<string, never>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const result = await this.sessions.refresh(this.cookies.read(request));

    // A rejected concurrent refresh must not clear the winner's cookie.
    this.cookies.set(response, result);

    return result.response;
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AuthCsrfGuard)
  async logout(
    @Body(EmptyBodyPipe) _body: Record<string, never>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessions.logout(
      this.cookies.read(request),
      readBearer(request.headers.authorization),
    );
    this.cookies.clear(response);
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }
}
