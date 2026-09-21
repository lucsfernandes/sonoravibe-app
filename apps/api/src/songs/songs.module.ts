import { Module } from '@nestjs/common';
import { CreditsModule } from '../credits/credits.module';
import { PlansModule } from '../plans/plans.module';
import { DownloadsService } from './downloads.service';
import { EditsController } from './edits.controller';
import { EditsService } from './edits.service';
import { LibraryService } from './library.service';
import { SongsController } from './songs.controller';
import { SongsService } from './songs.service';

@Module({
  imports: [CreditsModule, PlansModule],
  controllers: [SongsController, EditsController],
  providers: [SongsService, LibraryService, DownloadsService, EditsService],
  exports: [SongsService, LibraryService],
})
export class SongsModule {}
