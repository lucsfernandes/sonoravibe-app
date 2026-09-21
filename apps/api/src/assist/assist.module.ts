import { Module } from '@nestjs/common';
import { CreditsModule } from '../credits/credits.module';
import { AssistController } from './assist.controller';
import { AssistService } from './assist.service';

@Module({
  imports: [CreditsModule],
  controllers: [AssistController],
  providers: [AssistService],
})
export class AssistModule {}
