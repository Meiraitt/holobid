import { Injectable, NotFoundException } from '@nestjs/common';

import { MediaRepository } from './media.repository';

@Injectable()
export class MediaService {
  constructor(private readonly media: MediaRepository) {}

  async get(id: string) {
    const asset = await this.media.find(id);

    if (!asset) {
      throw new NotFoundException();
    }

    return asset;
  }
}
