import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';

import type { CredentialsInput } from '@holobid/contracts';

export class CredentialsDto implements CredentialsInput {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;

  // Passwords are never normalized, trimmed or silently truncated.
  @IsString()
  @Length(10, 128)
  password!: string;
}
