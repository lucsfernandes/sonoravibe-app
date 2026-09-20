import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { GenerationsModule } from './generations/generations.module';
import { HealthController } from './health/health.controller';
import { QueueModule } from './queue/queue.module';
import { SongsModule } from './songs/songs.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [ConfigModule, DatabaseModule, StorageModule, QueueModule, AuthModule, SongsModule, GenerationsModule],
  controllers: [HealthController],
})
export class AppModule {}
