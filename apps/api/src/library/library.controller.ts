import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, type SessionUser } from '../auth/session.guard';
import { parseOrThrow } from '../common/parse';
import { PlaylistsService } from './playlists.service';
import { StylesService } from './styles.service';
import { WorkspacesService } from './workspaces.service';

const nameSchema = z.object({ name: z.string().trim().min(1).max(100) });

const playlistSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  isPublic: z.boolean().default(false),
});

const styleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(2000),
  excludeStyles: z.string().trim().max(1000).optional(),
});

@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  list(@CurrentUser() user: SessionUser) {
    return this.workspaces.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    return this.workspaces.create(user.id, parseOrThrow(nameSchema, body, 'workspace').name);
  }

  @Patch(':id')
  rename(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.workspaces.rename(user.id, id, parseOrThrow(nameSchema, body, 'workspace').name);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.workspaces.remove(user.id, id);
  }
}

@Controller('playlists')
export class PlaylistsController {
  constructor(private readonly playlists: PlaylistsService) {}

  @Get()
  list(@CurrentUser() user: SessionUser) {
    return this.playlists.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    return this.playlists.create(user.id, parseOrThrow(playlistSchema, body, 'playlist'));
  }

  @Get(':id')
  findOne(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.playlists.findOne(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.playlists.update(
      user.id,
      id,
      parseOrThrow(playlistSchema.partial(), body, 'playlist'),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.playlists.remove(user.id, id);
  }

  @Post(':id/songs')
  addSong(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { songId } = parseOrThrow(
      z.object({ songId: z.string().uuid() }),
      body,
      'inclusão na playlist',
    );
    return this.playlists.addSong(user.id, id, songId);
  }

  @Delete(':id/songs/:songId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeSong(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('songId', ParseUUIDPipe) songId: string,
  ) {
    await this.playlists.removeSong(user.id, id, songId);
  }

  /** Reordena a playlist inteira de uma vez: é como o arrastar-e-soltar da UI funciona. */
  @Patch(':id/order')
  reorder(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { songIds } = parseOrThrow(
      z.object({ songIds: z.array(z.string().uuid()).min(1) }),
      body,
      'reordenação',
    );
    return this.playlists.reorder(user.id, id, songIds);
  }
}

@Controller('styles')
export class StylesController {
  constructor(private readonly styles: StylesService) {}

  @Get()
  list(@CurrentUser() user: SessionUser) {
    return this.styles.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    return this.styles.create(user.id, parseOrThrow(styleSchema, body, 'estilo'));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.styles.remove(user.id, id);
  }
}
