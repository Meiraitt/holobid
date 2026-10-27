import { HttpException } from '@nestjs/common';

import type { ApiErrorDetails } from '@holobid/contracts';

// Messages and details must be safe to expose to the caller.
export class ApiException extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
    readonly details?: ApiErrorDetails,
  ) {
    super(message, status);
  }
}
