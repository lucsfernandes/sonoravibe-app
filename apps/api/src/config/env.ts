import { z } from 'zod';

/**
 * Configuração validada na subida.
 *
 * Falhar aqui, com mensagem clara, é muito melhor do que descobrir uma variável
 * faltando no meio de uma geração — o usuário já teria pago créditos.
 */

const booleanish = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  /**
   * Cria o schema a partir das entidades. Só para desenvolvimento: em produção
   * o schema vem de migrations versionadas.
   */
  DB_SYNCHRONIZE: booleanish.optional(),

  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  R2_PUBLIC_URL: z.string().url().optional(),
  R2_ENDPOINT: z.string().url().optional(),

  /** Motor principal. 'mock' gera áudio sintético sem custo nem GPU. */
  MUSIC_PROVIDER: z.enum(['acestep', 'lyria', 'mock']).default('mock'),
  RUNPOD_API_KEY: z.string().optional(),
  RUNPOD_ENDPOINT_ID: z.string().optional(),

  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  OPENROUTER_TEXT_MODEL: z.string().default('google/gemini-2.5-flash'),
  OPENROUTER_IMAGE_MODEL: z.string().default('google/gemini-2.5-flash-image'),
  OPENROUTER_MUSIC_MODEL: z.string().default('google/lyria-3-pro-preview'),
  OPENROUTER_CLIP_MODEL: z.string().default('google/lyria-3-clip-preview'),
  OPENROUTER_APP_NAME: z.string().default('Sonora'),
  OPENROUTER_SITE_URL: z.string().url().default('https://sonora.app'),

  PAYMENT_PROVIDER: z.enum(['asaas', 'fake']).default('fake'),
  ASAAS_API_KEY: z.string().optional(),
  ASAAS_BASE_URL: z.string().url().default('https://api-sandbox.asaas.com/v3'),
  ASAAS_WEBHOOK_TOKEN: z.string().optional(),

  BETTER_AUTH_SECRET: z.string().min(32, 'gere com: openssl rand -base64 32'),
  BETTER_AUTH_URL: z.string().url().default('http://localhost:3001'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
});

export type AppConfig = z.infer<typeof envSchema> & {
  corsOrigins: string[];
  isProduction: boolean;
};

export const CONFIG = Symbol('sonora.config');

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuração inválida:\n${problems}`);
  }
  const env = parsed.data;

  // Combinações que só fazem sentido juntas: falhar agora, não na primeira geração.
  if (env.MUSIC_PROVIDER === 'acestep' && !(env.RUNPOD_API_KEY && env.RUNPOD_ENDPOINT_ID)) {
    throw new Error("MUSIC_PROVIDER='acestep' exige RUNPOD_API_KEY e RUNPOD_ENDPOINT_ID.");
  }
  if (env.MUSIC_PROVIDER === 'lyria' && !env.OPENROUTER_API_KEY) {
    throw new Error("MUSIC_PROVIDER='lyria' exige OPENROUTER_API_KEY.");
  }
  if (env.PAYMENT_PROVIDER === 'asaas' && !env.ASAAS_API_KEY) {
    throw new Error("PAYMENT_PROVIDER='asaas' exige ASAAS_API_KEY.");
  }
  if (env.NODE_ENV === 'production' && env.DB_SYNCHRONIZE) {
    throw new Error('DB_SYNCHRONIZE não pode ficar ligado em produção: use migrations.');
  }

  return {
    ...env,
    corsOrigins: env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
    isProduction: env.NODE_ENV === 'production',
  };
}
