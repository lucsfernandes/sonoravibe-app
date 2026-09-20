import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Public, type SessionUser } from '../auth/session.guard';
import { parseOrThrow } from '../common/parse';
import { AssistService, type LyricsResult } from './assist.service';

@Controller()
export class AssistController {
  constructor(private readonly assist: AssistService) {}

  @Post('lyrics/generate')
  lyrics(@CurrentUser() user: SessionUser, @Body() body: unknown): Promise<LyricsResult> {
    const data = parseOrThrow(
      z.object({
        brief: z.string().trim().min(3).max(1000),
        language: z.string().trim().default('pt-BR'),
        styles: z.string().trim().max(500).optional(),
      }),
      body,
      'escrita de letra',
    );
    return this.assist.writeLyrics(user.id, data.brief, data.language, data.styles);
  }

  /** O botão de dado. Público e grátis: é o primeiro contato de quem ainda nem criou conta. */
  @Public()
  @Post('styles/suggest')
  suggest(@Body() body: unknown) {
    const { seed } = parseOrThrow(
      z.object({ seed: z.string().trim().max(200).optional() }),
      body ?? {},
      'sugestão de estilo',
    );
    return this.assist.suggestStyle(seed);
  }
}
