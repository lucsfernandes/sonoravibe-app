import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { AUTH, type SonoraAuth } from './auth.config';

/**
 * Guard de sessão, registrado globalmente.
 *
 * O padrão é exigir autenticação: uma rota nova nasce protegida e só fica
 * pública se alguém escrever `@Public()`. O contrário — proteger rota a rota —
 * transforma cada endpoint esquecido num vazamento silencioso.
 */

const IS_PUBLIC = 'sonora:isPublic';

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
}
