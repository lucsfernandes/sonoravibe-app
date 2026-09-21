import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Sse } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { CurrentUser, type SessionUser } from '../auth/session.guard';
import { GenerationEventsService } from './generation-events.service';
import { GenerationsService, type GenerationView } from './generations.service';

@Controller('generations')
export class GenerationsController {
  constructor(
    private readonly generations: GenerationsService,
    private readonly events: GenerationEventsService,
  ) {}

  /**
   * Progresso ao vivo de todas as gerações do usuário, numa conexão só.
   *
   * Vem antes de `:id` de propósito: o Express casa as rotas na ordem em que
   * foram registradas, e `/generations/:id` engoliria `/generations/stream`.
   */
  @Sse('stream')
  stream(@CurrentUser() user: SessionUser): Observable<{ type: string; data: unknown }> {
    return this.events.streamFor(user.id);
  }

  @Get(':id')
  async findOne(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GenerationView> {
    return this.generations.findOne(user.id, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ refunded: number }> {
    return this.generations.cancel(user.id, id);
  }
}
