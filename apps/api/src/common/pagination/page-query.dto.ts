import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
export class PageQueryDto {
  @IsOptional() @IsString() @MaxLength(1024) cursor?: string;
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value)
  @IsInt() @Min(1) @Max(100) limit = 20;
}
