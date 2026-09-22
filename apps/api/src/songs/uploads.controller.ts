import { Controller, HttpCode, HttpStatus, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentUser, type SessionUser } from '../auth/session.guard';
import { parseOrThrow } from '../common/parse';
import type { SongSummary } from './library.service';
import { UploadsService } from './uploads.service';

/**
 * Recebe o áudio como corpo bruto, não como multipart.
 *
 * O parser de JSON da API tem teto de 1 MB e não serve para arquivo; um
 * `express.raw` registrado em `main.ts` só para esta rota entrega o corpo
 * inteiro em `req.body` como Buffer. Multipart exigiria multer e um formulário
 * a mais no cliente, para carregar um único arquivo por vez.
 */
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  receive(
    @CurrentUser() user: SessionUser,
    @Query() query: unknown,
    @Req() req: Request,
  ): Promise<SongSummary> {
    const { filename, workspaceId } = parseOrThrow(
      z.object({
        filename: z.string().trim().max(200).optional(),
        workspaceId: z.string().uuid().optional(),
      }),
      query,
      'upload',
    );
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    return this.uploads.receive(user.id, body, req.headers['content-type'], filename, workspaceId);
  }
}
