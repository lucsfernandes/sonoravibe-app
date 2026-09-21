import { Module } from '@nestjs/common';
import { AssistModule } from './assist/assist.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
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
  imports: [ConfigModule, DatabaseModule, StorageModule, QueueModule, AuthModule, SongsModule, GenerationsModule, LibraryModule, BillingModule, SocialModule, AssistModule],
  controllers: [HealthController],
})
export class AppModule {}
