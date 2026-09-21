import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CONFIG, type AppConfig } from '../config/env';
import { CreditsModule } from '../credits/credits.module';
import { AUTH, createAuth } from './auth.config';
import { OnboardingService } from './onboarding.service';
import { SessionGuard } from './session.guard';

export { AUTH } from './auth.config';

/**
 * Better Auth e o guard de sessão.
 *
 * O guard entra como APP_GUARD para valer em toda requisição: rota nova nasce
 * protegida, e só fica pública com `@Public()`.
 */
@Global()
@Module({
  imports: [CreditsModule],
  providers: [
    OnboardingService,
    {
      provide: AUTH,
      inject: [CONFIG, OnboardingService],
      useFactory: (config: AppConfig, onboarding: OnboardingService) =>
        createAuth(config, (user) => onboarding.onUserCreated(user)),
    },
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
  exports: [AUTH, OnboardingService],
})
export class AuthModule {}
