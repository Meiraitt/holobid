import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { EXTERNAL_ID } from './catalog-mapper';

function queryNumber(value: unknown): unknown {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value;
}
export class CatalogQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  q?: string;

  @Transform(({ value }: { value: unknown }) => queryNumber(value))
  @IsInt()
  @Min(1)
  @Max(10_000)
  page = 1;

  @Transform(({ value }: { value: unknown }) => queryNumber(value))
  @IsInt()
  @Min(1)
  @Max(20)
  limit = 20;
}
export class CatalogIdDto {
  @IsString()
  @Matches(EXTERNAL_ID)
  externalId!: string;
}
