import { Module } from '@nestjs/common';
import { CreditsModule } from '../credits/credits.module';
import { PlansModule } from '../plans/plans.module';
import { DownloadsService } from './downloads.service';
import { EditsController } from './edits.controller';
import { EditsService } from './edits.service';
import { LibraryService } from './library.service';
import { SongsController } from './songs.controller';
import { SongsService } from './songs.service';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  imports: [CreditsModule, PlansModule],
  controllers: [SongsController, EditsController, UploadsController],
  providers: [SongsService, LibraryService, DownloadsService, EditsService, UploadsService],
  exports: [SongsService, LibraryService],
})
export class SongsModule {}
