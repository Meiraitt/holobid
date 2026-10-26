import { randomBytes } from 'node:crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';

@Injectable()
export class PasswordService implements OnModuleInit {
  private dummyHash!: string;

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hash(randomBytes(32).toString('base64url'));
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  }

  async verify(password: string, storedHash: string | null): Promise<boolean> {
    // Missing accounts still perform a password verification with the same parameters.
    try {
      const valid = await argon2.verify(storedHash ?? this.dummyHash, password);
      return storedHash !== null && valid;
    } catch {
      return false;
    }
  }
}
