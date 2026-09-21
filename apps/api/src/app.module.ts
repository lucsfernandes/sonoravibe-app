import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AssistModule } from './assist/assist.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { ClientIpThrottlerGuard } from './common/throttle.guard';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { GenerationsModule } from './generations/generations.module';
import { HealthController } from './health/health.controller';
import { LibraryModule } from './library/library.module';
import { QueueModule } from './queue/queue.module';
import { SocialModule } from './social/social.module';
import { SongsModule } from './songs/songs.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule,
    // Teto geral por IP; rotas que chamam provedor pago apertam com @Throttle.
    // O contador é em memória, por réplica: com HPA cada pod conta o seu.
    ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: 60 }] }),
    DatabaseModule,
    StorageModule,
    QueueModule,
    AuthModule,
    SongsModule,
    GenerationsModule,
    LibraryModule,
    BillingModule,
    SocialModule,
    AssistModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ClientIpThrottlerGuard }],
})
export class AppModule {}
