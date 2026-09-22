import { Module } from '@nestjs/common';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';

@Module({
  controllers: [SocialController, MeController],
  providers: [SocialService, MeService],
  exports: [SocialService],
})
export class SocialModule {}
