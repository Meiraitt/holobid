import { Module } from '@nestjs/common';
import { AuctionsModule } from '../auctions/auctions.module';
import { DemoCoreModule } from './demo-core.module';
import { DemoRotation } from './demo-rotation.service';
@Module({ imports: [DemoCoreModule, AuctionsModule], providers: [DemoRotation] })
export class DemoModule {}
