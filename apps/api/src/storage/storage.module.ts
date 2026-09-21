import { Global, Module } from '@nestjs/common';
import { StorageService } from '@sonora/storage';
import { CONFIG, type AppConfig } from '../config/env';

export const STORAGE = Symbol('sonora.storage');

/** Cloudflare R2 (ou MinIO em desenvolvimento, via R2_ENDPOINT). */
@Global()
@Module({
  providers: [
    {
      provide: STORAGE,
      inject: [CONFIG],
      useFactory: (config: AppConfig) =>
        new StorageService({
          accountId: config.R2_ACCOUNT_ID,
          accessKeyId: config.R2_ACCESS_KEY_ID,
          secretAccessKey: config.R2_SECRET_ACCESS_KEY,
          bucket: config.R2_BUCKET,
          publicUrl: config.R2_PUBLIC_URL,
          endpoint: config.R2_ENDPOINT,
        }),
    },
  ],
  exports: [STORAGE],
})
export class StorageModule {}
