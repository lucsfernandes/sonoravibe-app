import { Module } from '@nestjs/common';
import { CreditsModule } from '../credits/credits.module';
import { GenerationEventsService } from './generation-events.service';
import { GenerationsController } from './generations.controller';
import { GenerationsService } from './generations.service';

@Module({
  imports: [CreditsModule],
  controllers: [GenerationsController],
  providers: [GenerationsService, GenerationEventsService],
  exports: [GenerationEventsService],
})
export class GenerationsModule {}
