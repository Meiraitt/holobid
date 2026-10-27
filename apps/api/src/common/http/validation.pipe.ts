import { HttpStatus, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

import { ApiException } from './api.exception';

function fieldErrors(errors: ValidationError[], prefix = ''): Record<string, string[]> {
  const fields: Record<string, string[]> = Object.create(null);

  for (const error of errors) {
    const path = prefix ? `${prefix}.${error.property}` : error.property;

    if (error.constraints) {
      fields[path] = ['Invalid value.'];
    }

    Object.assign(fields, fieldErrors(error.children ?? [], path));
  }

  return fields;
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    transformOptions: { enableImplicitConversion: false },
    validationError: { target: false, value: false },
    exceptionFactory: (errors) =>
      new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Invalid request data.', {
        fieldErrors: fieldErrors(errors),
      }),
  });
}
