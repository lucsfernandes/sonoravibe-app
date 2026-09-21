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
  Query,
  Res,
} from '@nestjs/common';
import { AUDIO_FORMATS, generationRequestSchema, type AudioFormat } from '@sonora/shared';
import { ZipArchive } from 'archiver';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, Public, type SessionUser } from '../auth/session.guard';
import { parseOrThrow as parse } from '../common/parse';
import { DownloadsService } from './downloads.service';
import { LibraryService, type Page, type SongDetail, type SongSummary } from './library.service';
import { SongsService, type GenerateResult } from './songs.service';

const listQuerySchema = z.object({
  workspaceId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  filter: z.enum(['all', 'public', 'private', 'liked']).default('all'),
});

const updateSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  workspaceId: z.string().uuid().nullable().optional(),
  allowRemixes: z.boolean().optional(),
  allowComments: z.boolean().optional(),
});

const batchSchema = z.object({
  songIds: z.array(z.string().uuid()).min(1).max(50),
  format: z.enum(AUDIO_FORMATS).default('mp3'),
});

@Controller('songs')
export class SongsController {
  constructor(
    private readonly songs: SongsService,
    private readonly library: LibraryService,
    private readonly downloads: DownloadsService,
  ) {}

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
    return this.songs.generate(user, parse(generationRequestSchema, body, 'geração'));
  }

  @Get()
  async list(
    @CurrentUser() user: SessionUser,
    @Query() query: unknown,
  ): Promise<Page<SongSummary>> {
    return this.library.list(user.id, parse(listQuerySchema, query, 'listagem'));
  }

  /**
   * Download em lote, como ZIP em streaming.
   *
   * Vem antes de `:id` porque o Express casa rotas na ordem de registro, e
   * `/songs/:id` engoliria `/songs/download-batch`.
   */
  @Post('download-batch')
  async downloadBatch(
    @CurrentUser() user: SessionUser,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const { songIds, format } = parse(batchSchema, body, 'download em lote');
    const batch = await this.downloads.prepareBatch(user.id, songIds, format);

    if (!batch.ready) {
      res.status(HttpStatus.ACCEPTED).set('Retry-After', '10').json({
        status: 'processing',
        pending: batch.pending,
        message: `Convertendo ${batch.pending.length} de ${songIds.length} faixas. Tente de novo em alguns segundos.`,
      });
      return;
    }

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="sonora-${format}.zip"`,
    });

    // `store` e não `deflate`: áudio já é comprimido, e tentar comprimir de novo
    // gastaria CPU para economizar quase nada.
    // O archiver 8 não exporta mais a função `archiver('zip')` — só as classes.
    const zip = new ZipArchive({ store: true });
    zip.on('error', (err: Error) => res.destroy(err));
    zip.pipe(res);

    // Nomes repetidos ganham sufixo: duas músicas podem ter o mesmo título, e
    // um ZIP com entradas duplicadas abre errado em vários descompactadores.
    const usados = new Map<string, number>();
    for (const entry of batch.entries) {
      const vezes = usados.get(entry.filename) ?? 0;
      usados.set(entry.filename, vezes + 1);
      const name = vezes === 0 ? entry.filename : sufixar(entry.filename, vezes + 1);

      zip.append(await this.downloads.streamOf(entry.storageKey), { name });
    }

    await zip.finalize();
  }

  // Pública: música publicada no Explore abre sem login. O serviço devolve 404
  // para música privada de outra pessoa, então o @Public() não vaza nada.
  @Public()
  @Get(':id')
  async findOne(
    @CurrentUser() user: SessionUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SongDetail> {
    return this.library.findOne(user?.id ?? null, id);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<SongDetail> {
    return this.library.update(user.id, id, parse(updateSchema, body, 'atualização'));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.library.remove(user.id, id);
  }

  @Post(':id/publish')
  async publish(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<SongDetail> {
    const { isPublic } = parse(z.object({ isPublic: z.boolean() }), body, 'publicação');
    return this.library.publish(user.id, id, isPublic);
  }

  /**
   * Download de um formato.
   *
   * Responde 302 para uma URL assinada do R2 quando o arquivo existe, ou 202
   * com Retry-After enquanto o FFmpeg converte.
   *
   * Com `Accept: application/json`, devolve `{ url }` em vez de redirecionar.
   * É o que a interface usa: com o 302 puro, o navegador seguiria o redirect e
   * o front não teria como distinguir "pronto" de "convertendo" para mostrar o
   * aviso certo — um link simples abriria um JSON numa aba nova.
   */
  @Get(':id/download')
  async download(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('format') formatRaw: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const { format } = parse(
      z.object({ format: z.enum(AUDIO_FORMATS).default('mp3') }),
      { format: formatRaw },
      'download',
    );

    const result = await this.downloads.download(user.id, id, format as AudioFormat);

    if (result.ready) {
      if (querJson(res.req.headers.accept)) {
        res.status(HttpStatus.OK).json({ status: 'ready', url: result.url, filename: result.filename });
        return;
      }
      res.redirect(HttpStatus.FOUND, result.url);
      return;
    }
    res
      .status(HttpStatus.ACCEPTED)
      .set('Retry-After', String(result.retryAfterSeconds))
      .json({ status: 'processing', message: result.message });
  }
}

/**
 * O cliente quer JSON, ou aceita o redirect?
 *
 * Isto decide entre devolver `{ url }` e responder 302 para o R2, e a escolha
 * errada quebra o download de um jeito difícil de ler: o navegador segue o
 * redirect para outra origem, o R2 não manda cabeçalho de CORS, e o `fetch`
 * rejeita com um "Failed to fetch" sem status nem corpo. Foi o que aconteceu em
 * produção — a interface não mandava `Accept` nenhum, o padrão do navegador é o
 * coringa, que não casa, e o usuário via "convertendo..." seguido de erro
 * genérico para um arquivo que já estava pronto.
 *
 * É uma função com nome, e não uma condição embutida no handler, para poder ser
 * testada: a regra é curta, mas errá-la custa a funcionalidade inteira.
 *
 * O coringa NÃO conta como pedido de JSON, de propósito: é o que um `<a href>`
 * comum manda, e para ele o redirect é o comportamento certo. Quem quer JSON
 * pede JSON.
 */
export function querJson(accept: string | undefined): boolean {
  return accept?.toLowerCase().includes('application/json') ?? false;
}

function sufixar(filename: string, n: number): string {
  const ponto = filename.lastIndexOf('.');
  return `${filename.slice(0, ponto)} (${n})${filename.slice(ponto)}`;
}
