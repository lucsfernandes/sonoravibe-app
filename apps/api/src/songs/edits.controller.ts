import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { EDIT_OPERATIONS, STEM_KINDS } from '@sonora/shared';
import { z } from 'zod';
import { CurrentUser, type SessionUser } from '../auth/session.guard';
import { parseOrThrow } from '../common/parse';
import { EditsService } from './edits.service';

@Controller('songs/:id')
export class EditsController {
  constructor(private readonly edits: EditsService) {}

  @Post('extend')
  extend(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { addSeconds } = parseOrThrow(
      z.object({ addSeconds: z.number().int().min(10).max(240) }),
      body,
      'extensão',
    );
    return this.edits.extend(user.id, id, addSeconds);
  }

  @Post('remix')
  remix(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { styles } = parseOrThrow(
      z.object({ styles: z.string().trim().min(3).max(1000) }),
      body,
      'remix',
    );
    return this.edits.remix(user.id, id, styles);
  }

  @Post('replace-section')
  replaceSection(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const data = parseOrThrow(
      z.object({
        startMs: z.number().int().min(0),
        endMs: z.number().int().min(1),
        styles: z.string().trim().max(1000).optional(),
      }),
      body,
      'substituição de trecho',
    );
    return this.edits.replaceSection(user.id, id, data);
  }

  @Post('cover-art')
  coverArt(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { prompt } = parseOrThrow(
      z.object({ prompt: z.string().trim().max(1000).optional() }),
      body ?? {},
      'capa',
    );
    return this.edits.coverArt(user.id, id, prompt);
  }

  @Post('edit')
  edit(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const data = parseOrThrow(
      z.object({
        operation: z.enum(EDIT_OPERATIONS),
        startMs: z.number().int().min(0).optional(),
        endMs: z.number().int().min(1).optional(),
        durationMs: z.number().int().min(100).max(30_000).optional(),
        factor: z.number().min(0.5).max(2).optional(),
      }),
      body,
      'edição',
    );

    const { operation, ...params } = data;
    const numericos = Object.fromEntries(
      Object.entries(params).filter(([, v]) => typeof v === 'number'),
    ) as Record<string, number>;

    return this.edits.edit(user.id, id, operation, numericos);
  }

  @Post('stems')
  stems(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { kinds } = parseOrThrow(
      z.object({ kinds: z.array(z.enum(STEM_KINDS)).min(1).default([...STEM_KINDS]) }),
      body ?? {},
      'separação de stems',
    );
    return this.edits.stems(user.id, id, kinds);
  }
}
