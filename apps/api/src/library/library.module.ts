import { Module } from '@nestjs/common';
import {
  PlaylistsController,
  StylesController,
  WorkspacesController,
} from './library.controller';
import { PlaylistsService } from './playlists.service';
import { StylesService } from './styles.service';
import { WorkspacesService } from './workspaces.service';

@Module({
  controllers: [WorkspacesController, PlaylistsController, StylesController],
  providers: [WorkspacesService, PlaylistsService, StylesService],
  exports: [WorkspacesService, PlaylistsService, StylesService],
})
export class LibraryModule {}
