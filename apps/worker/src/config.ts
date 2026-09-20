import { z } from 'zod';

/**
 * Configuração do worker, validada na subida.
 *
 * É um subconjunto do que a API valida: o worker não atende HTTP, não conhece
 * sessão e não fala com o gateway de pagamento. Repetir só o necessário é
 * melhor do que compartilhar um schema gigante em que metade das variáveis
 * ficaria irrelevante — e mascararia um secret faltando no deploy errado.
 */

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  R2_PUBLIC_URL: z.string().url().optional(),
  R2_ENDPOINT: z.string().url().optional(),

  MUSIC_PROVIDER: z.enum(['acestep', 'lyria', 'mock']).default('mock'),
  RUNPOD_API_KEY: z.string().optional(),
  RUNPOD_ENDPOINT_ID: z.string().optional(),
  /** Aponta para o emulador local do SDK da RunPod, quando houver. */
  RUNPOD_BASE_URL: z.string().url().optional(),

  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  OPENROUTER_MUSIC_MODEL: z.string().default('google/lyria-3-pro-preview'),
  OPENROUTER_CLIP_MODEL: z.string().default('google/lyria-3-clip-preview'),
  OPENROUTER_APP_NAME: z.string().default('Sonora'),
  OPENROUTER_SITE_URL: z.string().url().default('https://sonora.app'),

  /** Quantos jobs de geração este processo atende ao mesmo tempo. */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(3),
  FFMPEG_PATH: z.string().default('ffmpeg'),
});

export type WorkerConfig = z.infer<typeof envSchema> & { isProduction: boolean };

/**
 * Variável definida como vazia (`FFMPEG_PATH=` no .env) significa "não
 * configurada", e não "string vazia". Sem isso ela vence o `.default()` do
 * schema — foi assim que um FFMPEG_PATH em branco derrubou o motor de áudio e
 * fez o roteador cair no provedor pago.
 */
function withoutEmpty(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value?.trim() !== ''),
  );
}

export function loadWorkerConfig(source: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = envSchema.safeParse(withoutEmpty(source));
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuração inválida do worker:\n${problems}`);
  }
  const env = parsed.data;

  if (env.MUSIC_PROVIDER === 'acestep' && !env.RUNPOD_BASE_URL) {
    if (!(env.RUNPOD_API_KEY && env.RUNPOD_ENDPOINT_ID)) {
      throw new Error(
        "MUSIC_PROVIDER='acestep' exige RUNPOD_API_KEY e RUNPOD_ENDPOINT_ID " +
          '(ou RUNPOD_BASE_URL, para o emulador local).',
      );
    }
  }
  if (env.MUSIC_PROVIDER === 'lyria' && !env.OPENROUTER_API_KEY) {
    throw new Error("MUSIC_PROVIDER='lyria' exige OPENROUTER_API_KEY.");
  }

  return { ...env, isProduction: env.NODE_ENV === 'production' };
}
