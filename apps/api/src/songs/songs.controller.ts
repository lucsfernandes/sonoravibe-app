import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { generationRequestSchema } from '@sonora/shared';
import { CurrentUser, type SessionUser } from '../auth/session.guard';
import { SongsService, type GenerateResult } from './songs.service';

@Controller('songs')
export class SongsController {
  constructor(private readonly songs: SongsService) {}

  /**
   * Enfileira uma geração. Responde 202: o trabalho ainda não aconteceu —
   * o progresso chega por SSE em /generations/stream.
   */
  @Post('generate')
  @HttpCode(HttpStatus.ACCEPTED)
  async generate(
    @CurrentUser() user: SessionUser,
    @Body() body: unknown,
  ): Promise<GenerateResult> {
    const parsed = generationRequestSchema.safeParse(body);
    if (!parsed.success) {
      // O caminho do campo vai junto: "controls.bpm: ..." é acionável na UI,
      // "requisição inválida" não é.
      throw new BadRequestException({
        message: 'Requisição de geração inválida.',
        issues: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    return this.songs.generate(user, parsed.data);
  }
}
