import { Injectable } from '@nestjs/common';

import { ApiException } from '../../common/http/api.exception';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/main/client';
import { UsersRepository } from '../users/users.repository';
import { WalletsRepository } from '../wallets/wallets.repository';

import { CredentialsDto } from './credentials.dto';
import { PasswordService } from './password.service';
import { SessionResult, SessionsService } from './sessions.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly users: UsersRepository,
    private readonly wallets: WalletsRepository,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionsService,
  ) {}

  async register(input: CredentialsDto): Promise<SessionResult> {
    const passwordHash = await this.passwords.hash(input.password);

    try {
      return await this.database.transaction(async (tx) => {
        const user = await this.users.create(
          { email: input.email, passwordHash, role: 'BIDDER' },
          tx,
        );

        await this.wallets.create(user.id, tx);

        return this.sessions.issue(user, tx);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiException(409, 'EMAIL_ALREADY_EXISTS', 'Email is already registered.');
      }

      throw error;
    }
  }

  async login(input: CredentialsDto): Promise<SessionResult> {
    const user = await this.users.findByEmail(input.email);

    if (!(await this.passwords.verify(input.password, user?.passwordHash ?? null)) || !user) {
      throw new ApiException(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }

    return this.database.transaction((tx) => this.sessions.issue(user, tx));
  }
}
