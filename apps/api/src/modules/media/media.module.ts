import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';

import { MediaController } from './media.controller';
import { MediaRepository } from './media.repository';
import { MediaService } from './media.service';

@Module({
  imports: [DatabaseModule],
  controllers: [MediaController],
  providers: [MediaRepository, MediaService],
  exports: [MediaRepository],
})
export class MediaModule {}
