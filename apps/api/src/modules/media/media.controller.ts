import { Controller, Get, Headers, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import type { Response } from 'express';

import { MediaService } from './media.service';

@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get(':assetId')
  async get(
    @Param('assetId', ParseUUIDPipe) id: string,
    @Headers('if-none-match') match: string | undefined,
    @Res() response: Response,
  ) {
    const asset = await this.media.get(id);
    const etag = `"${asset.sha256}"`;

    response.setHeader('ETag', etag);
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.setHeader('X-Content-Type-Options', 'nosniff');

    const matches = match
      ?.split(',')
      .some((value) => value.trim() === '*' || value.trim().replace(/^W\//, '') === etag);

    if (matches) {
      response.status(304).end();

      return;
    }

    response.setHeader('Content-Type', asset.mimeType);
    response.setHeader('Content-Length', asset.size);
    response.status(200).send(Buffer.from(asset.bytes));
  }
}
