import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { CONFIG, type AppConfig } from '../config/env';
import { AUTH, type SonoraAuth } from './auth.config';

/**
 * Guard de sessão, registrado globalmente.
 *
 * O padrão é exigir autenticação: uma rota nova nasce protegida e só fica
 * pública se alguém escrever `@Public()`. O contrário — proteger rota a rota —
 * transforma cada endpoint esquecido num vazamento silencioso.
 */

const IS_PUBLIC = 'sonora:isPublic';

/** Métodos que não mudam estado: não precisam da checagem de origem. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Libera a rota para quem não está autenticado. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  image?: string | null;
}

/** Requisição com a sessão já resolvida pelo guard. */
export interface AuthedRequest extends Request {
  user?: SessionUser;
}

/** Injeta o usuário autenticado no parâmetro do handler. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<AuthedRequest>();
  return request.user;
});

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(AUTH) private readonly auth: SonoraAuth,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();

    // Mesmo em rota pública resolvemos a sessão quando ela existe: o Explore
    // muda o que mostra para quem está logado (curtidas próprias, seguidos).
    const session = await this.auth.api
      .getSession({ headers: fromNodeHeaders(request.headers) })
      .catch(() => null);

    if (session?.user) {
      request.user = {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        image: session.user.image ?? null,
      };
      if (!SAFE_METHODS.has(request.method)) this.assertSameSite(request);
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    if (!request.user) {
      throw new UnauthorizedException('Faça login para continuar.');
    }
    return true;
  }

  /**
   * O cookie de sessão é SameSite=None (o app e a API vivem em origens
   * diferentes), então o navegador o envia até em requisição disparada por
   * outro site. Sem esta checagem, uma página maliciosa faz o navegador de
   * quem está logado gastar créditos ou cancelar a assinatura sem a pessoa
   * perceber. CORS não protege disso: ele só esconde a resposta, o pedido
   * chega do mesmo jeito.
   *
   * Cliente sem navegador (curl, Postman) não manda Origin nem Sec-Fetch-Site
   * e passa: ele também não carrega o cookie de outra pessoa.
   */
  private assertSameSite(request: AuthedRequest): void {
    const origin = request.headers.origin;
    if (origin !== undefined) {
      if (!this.config.corsOrigins.includes(origin)) {
        throw new ForbiddenException('Origem não permitida.');
      }
      return;
    }
    if (request.headers['sec-fetch-site'] === 'cross-site') {
      throw new ForbiddenException('Origem não permitida.');
    }
  }
}
