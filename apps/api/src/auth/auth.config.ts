import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { Pool } from 'pg';
import type { AppConfig } from '../config/env';

/**
 * Configuração do Better Auth.
 *
 * É uma função pura, sem DI do Nest, porque duas partes da aplicação precisam
 * dela em momentos diferentes: o DatabaseModule roda as migrations do Better
 * Auth antes de o TypeORM criar o schema de domínio (as tabelas de música
 * referenciam `user.id`, então `user` tem que existir primeiro), e o AuthModule
 * monta a instância que atende as requisições. Se isso fosse um provider do
 * Nest, os dois módulos ficariam em dependência circular.
 *
 * O Better Auth usa um Pool `pg` próprio, separado do DataSource do TypeORM —
 * ele é dono das tabelas `user`, `session`, `account` e `verification`, e as
 * entidades do domínio só as leem.
 */

/** Gancho chamado logo após o Better Auth criar um usuário. */
export type OnUserCreated = (user: { id: string; email: string; name: string }) => Promise<void>;

export function buildAuthOptions(
  config: AppConfig,
  onUserCreated?: OnUserCreated,
): BetterAuthOptions {
  const hasGoogle = Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET);

  return {
    appName: 'Sonora',
    baseURL: config.BETTER_AUTH_URL,
    secret: config.BETTER_AUTH_SECRET,
    basePath: '/api/auth',

    database: new Pool({ connectionString: config.DATABASE_URL, max: 5 }),

    // O frontend roda em outra origem (3000 → 3001), então o cookie de sessão
    // precisa ser aceito de lá explicitamente.
    trustedOrigins: config.corsOrigins,

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      // Verificação de e-mail exige serviço de envio; fica para quando o
      // domínio estiver configurado. Até lá, cadastrar já entra.
      requireEmailVerification: false,
    },

    ...(hasGoogle
      ? {
          socialProviders: {
            google: {
              clientId: config.GOOGLE_CLIENT_ID as string,
              clientSecret: config.GOOGLE_CLIENT_SECRET as string,
            },
          },
        }
      : {}),

    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 dias
      updateAge: 60 * 60 * 24, // renova o cookie no máximo uma vez por dia
      cookieCache: {
        // Sem isso, toda requisição autenticada vira um SELECT na tabela de
        // sessão — inclusive as do SSE, que reconectam sozinhas.
        enabled: true,
        maxAge: 5 * 60,
      },
    },

    advanced: {
      // Cookie cross-site só funciona com SameSite=None + Secure, e isso exige
      // HTTPS. Em desenvolvimento (http://localhost) mantemos Lax.
      useSecureCookies: config.isProduction,
      defaultCookieAttributes: config.isProduction
        ? { sameSite: 'none' as const, secure: true }
        : undefined,
    },

    ...(onUserCreated
      ? {
          databaseHooks: {
            user: {
              create: {
                after: async (user: { id: string; email: string; name: string }) => {
                  await onUserCreated(user);
                },
              },
            },
          },
        }
      : {}),
  };
}

export type SonoraAuth = ReturnType<typeof betterAuth>;

/**
 * Token de injeção. Fica aqui, e não no AuthModule, porque o guard precisa dele:
 * se o guard importasse do módulo e o módulo importasse o guard, o símbolo
 * chegaria `undefined` no decorator, que é avaliado na carga do arquivo.
 */
export const AUTH = Symbol('sonora.auth');

export function createAuth(config: AppConfig, onUserCreated?: OnUserCreated): SonoraAuth {
  return betterAuth(buildAuthOptions(config, onUserCreated));
}
