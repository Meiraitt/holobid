import { Controller, Get, Param } from '@nestjs/common';

import { ReceiptsService } from './receipts.service';

@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get(':publicCode')
  get(@Param('publicCode') code: string) {
    return this.receipts.get(code);
  }
}
