import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentUser, Public, type SessionUser } from '../auth/session.guard';
import { parseOrThrow } from '../common/parse';
import { SocialService, type ExploreItem, type RelatedSongs } from './social.service';

const commentSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  timestampMs: z.number().int().min(0).optional(),
  parentId: z.string().uuid().optional(),
});

@Controller()
export class SocialController {
  constructor(private readonly social: SocialService) {}

  /** Explore abre sem login; quem está logado vê as próprias curtidas marcadas. */
  @Public()
  @Get('explore')
  explore(
    @CurrentUser() user: SessionUser | undefined,
    @Query() query: unknown,
  ): Promise<ExploreItem[]> {
    const { tab, limit, q } = parseOrThrow(
      z.object({
        tab: z.enum(['trending', 'new', 'following']).default('trending'),
        limit: z.coerce.number().int().min(1).max(50).default(24),
        /** Busca por título ou estilo: é como o "+ Áudio" acha uma faixa pública. */
        q: z.string().trim().max(200).optional(),
      }),
      query,
      'explore',
    );
    return this.social.explore(user?.id ?? null, tab, limit, q);
  }

  @Public()
  @Get('users/:handle')
  profile(@CurrentUser() user: SessionUser | undefined, @Param('handle') handle: string) {
    return this.social.profileOf(user?.id ?? null, handle);
  }

  @Post('users/:handle/follow')
  @HttpCode(HttpStatus.OK)
  follow(@CurrentUser() user: SessionUser, @Param('handle') handle: string) {
    return this.social.toggleFollow(user.id, handle);
  }

  @Post('songs/:id/like')
  @HttpCode(HttpStatus.OK)
  like(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.social.toggleLike(user.id, id);
  }

  /**
   * A lateral da página da música: parecidas e do mesmo autor. Pública como a
   * própria página; o serviço responde 404 para música privada de outra pessoa.
   */
  @Public()
  @Get('songs/:id/related')
  related(
    @CurrentUser() user: SessionUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: unknown,
  ): Promise<RelatedSongs> {
    const { limit } = parseOrThrow(
      z.object({ limit: z.coerce.number().int().min(1).max(30).default(12) }),
      query,
      'relacionadas',
    );
    return this.social.related(user?.id ?? null, id, limit);
  }

  @Public()
  @Get('songs/:id/comments')
  comments(
    @CurrentUser() user: SessionUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.social.comments(user?.id ?? null, id);
  }

  @Post('songs/:id/comments')
  comment(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.social.comment(user.id, id, parseOrThrow(commentSchema, body, 'comentário'));
  }

  @Delete('songs/:id/comments/:commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeComment(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    await this.social.removeComment(user.id, id, commentId);
  }

  /**
   * Registro de reprodução. Público porque o Explore toca sem login — para
   * ouvinte anônimo, a deduplicação usa uma impressão digital derivada de IP e
   * user-agent, que some em 30 segundos e não identifica ninguém.
   */
  @Public()
  @Post('songs/:id/play')
  @HttpCode(HttpStatus.OK)
  play(
    @CurrentUser() user: SessionUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const { listenedMs } = parseOrThrow(
      z.object({ listenedMs: z.number().int().min(0).max(30 * 60_000) }),
      body,
      'reprodução',
    );
    return this.social.registerPlay(user?.id ?? null, id, listenedMs, fingerprintOf(req));
  }
}

/**
 * Impressão digital efêmera do ouvinte anônimo.
 *
 * É um hash de IP + user-agent, usado só como chave de deduplicação com 30 s de
 * validade no Redis. Guardar o IP em claro seria dado pessoal sem necessidade.
 */
function fingerprintOf(req: Request): string {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';
  const agent = (req.headers['user-agent'] as string) ?? '';
  return createHash('sha256').update(`${ip}|${agent}`).digest('hex').slice(0, 24);
}
