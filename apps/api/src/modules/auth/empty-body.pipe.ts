import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

@Injectable()
export class EmptyBodyPipe implements PipeTransform {
  transform(value: unknown): Record<string, never> {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length !== 0
    ) {
      throw new BadRequestException();
    }

    return value as Record<string, never>;
  }
}
