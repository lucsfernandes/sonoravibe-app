import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentUser, type SessionUser } from '../auth/session.guard';
import { parseOrThrow } from '../common/parse';
import { MeService, type MeView } from './me.service';

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  bio: z.string().trim().max(500).nullable().optional(),
});

/** O usuário logado: leitura e edição do próprio perfil. Tudo exige sessão. */
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  get(@CurrentUser() user: SessionUser): Promise<MeView> {
    return this.me.get(user.id);
  }

  @Patch()
  update(@CurrentUser() user: SessionUser, @Body() body: unknown): Promise<MeView> {
    return this.me.update(user.id, parseOrThrow(updateSchema, body, 'perfil'));
  }

  /**
   * A foto chega como corpo bruto (ver `express.raw` em main.ts), do mesmo
   * jeito que o áudio em /uploads: um arquivo por vez, sem multipart.
   */
  @Post('avatar')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  avatar(@CurrentUser() user: SessionUser, @Req() req: Request): Promise<{ avatarUrl: string }> {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    return this.me.setAvatar(user.id, body, req.headers['content-type']);
  }

  @Delete('avatar')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeAvatar(@CurrentUser() user: SessionUser): Promise<void> {
    await this.me.removeAvatar(user.id);
  }
}
