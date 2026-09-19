import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AudioFormat, StemKind } from '@sonora/shared';
import { AUDIO_FORMAT_SPECS } from '@sonora/shared';

/**
 * Armazenamento de áudio e capas no Cloudflare R2 (API compatível com S3).
 *
 * Duas formas de gravar:
 *  - `putObject`: o nosso worker grava direto (transcodes, capas, stems).
 *  - `presignPut`: entregamos uma URL assinada para quem está fora do cluster
 *    gravar por conta própria. É como o worker GPU da RunPod sobe o master:
 *    a resposta da RunPod é limitada a 10–30 MB e um master FLAC passa disso.
 *
 * MEDIDO em 2026-09-19 contra o bucket real: o R2 NÃO valida o Content-Type
 * da assinatura. Um PUT com tipo divergente é aceito (HTTP 200) e o objeto fica
 * gravado com o tipo errado, que depois é servido ao player. Por isso quem
 * finaliza a geração confere o objeto com `statObject` em vez de confiar na
 * assinatura.
 */

export interface StorageConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Domínio público (ou CDN) na frente do bucket, para montar URLs de leitura. */
  publicUrl?: string;
  /** Sobrescreve o endpoint — usado pelo MinIO no ambiente de desenvolvimento. */
  endpoint?: string;
  /** MinIO exige path-style; o R2 aceita os dois. */
  forcePathStyle?: boolean;
}

/** Validade padrão de uma URL assinada de escrita: cobre cold start + geração. */
export const UPLOAD_URL_TTL_SECONDS = 30 * 60;
/** Validade de uma URL assinada de leitura entregue ao player ou ao download. */
export const DOWNLOAD_URL_TTL_SECONDS = 60 * 60;

export class StorageService {
  private readonly client: S3Client;
  readonly bucket: string;

  constructor(private readonly config: StorageConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      // O R2 é single-region; a região é formal e precisa existir para assinar.
      region: 'auto',
      endpoint: config.endpoint ?? `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle ?? Boolean(config.endpoint),
    });
  }

  /**
   * URL de escrita. O `contentType` vai na assinatura por convenção do SDK,
   * mas o R2 não o valida: confira o objeto depois com `statObject`.
   */
  presignPut(key: string, contentType: string, expiresIn = UPLOAD_URL_TTL_SECONDS): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn },
    );
  }

  /** URL de leitura temporária, para faixas privadas. */
  presignGet(key: string, expiresIn = DOWNLOAD_URL_TTL_SECONDS, downloadAs?: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: downloadAs ? `attachment; filename="${downloadAs}"` : undefined,
      }),
      { expiresIn },
    );
  }

  async putObject(key: string, body: Buffer | Readable, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async getObject(key: string): Promise<Buffer> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const chunks: Buffer[] = [];
    for await (const chunk of response.Body as Readable) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  /** Stream de leitura: usado no ZIP em lote, para não carregar tudo em memória. */
  async getObjectStream(key: string): Promise<Readable> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return response.Body as Readable;
  }

  /** Tamanho em bytes, ou null quando o objeto não existe. */
  async sizeOf(key: string): Promise<number | null> {
    return (await this.statObject(key))?.size ?? null;
  }

  /**
   * Tamanho e Content-Type gravados, ou null quando o objeto não existe.
   * Usado para conferir o que um worker externo subiu: o R2 aceita qualquer
   * Content-Type na URL assinada, então a checagem é nossa.
   */
  async statObject(key: string): Promise<{ size: number; contentType?: string } | null> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: head.ContentLength ?? 0, contentType: head.ContentType };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** URL pública (CDN). Só use com objetos de faixas publicadas. */
  publicUrl(key: string): string {
    if (!this.config.publicUrl) {
      throw new Error('R2_PUBLIC_URL não configurada: não há URL pública para este bucket.');
    }
    return `${this.config.publicUrl.replace(/\/+$/, '')}/${key}`;
  }
}

function isNotFound(err: unknown): boolean {
  const name = (err as { name?: string })?.name;
  const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  return name === 'NotFound' || name === 'NoSuchKey' || status === 404;
}

// ---------------------------------------------------------------------------
// Chaves — um único lugar decide o layout do bucket
// ---------------------------------------------------------------------------

/**
 * O master vive separado dos formatos derivados: ele nunca é reescrito nem
 * expira, enquanto os derivados são cache com validade de 7 dias.
 */
export const storageKeys = {
  master: (songId: string, format: 'flac' | 'mp3') => `songs/${songId}/master.${format}`,
  rendition: (songId: string, format: AudioFormat) => `songs/${songId}/renditions/master.${format}`,
  stem: (songId: string, kind: StemKind) => `songs/${songId}/stems/${kind}.flac`,
  cover: (songId: string) => `songs/${songId}/cover.jpg`,
  avatar: (userId: string) => `avatars/${userId}.jpg`,
  backup: (isoDate: string) => `backups/postgres/${isoDate}.sql.gz`,
} as const;

export function contentTypeFor(format: AudioFormat): string {
  return AUDIO_FORMAT_SPECS[format].mimeType;
}
