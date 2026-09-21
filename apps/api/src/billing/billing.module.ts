import { Module } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config/env';
import { CreditsModule } from '../credits/credits.module';
import { PlansModule } from '../plans/plans.module';
import { AsaasProvider } from './asaas.provider';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { FakePaymentProvider } from './fake.provider';
import { PAYMENT_PROVIDER } from './payment.provider';

@Module({
  imports: [CreditsModule, PlansModule],
  controllers: [BillingController],
  providers: [
    BillingService,
    {
      provide: PAYMENT_PROVIDER,
      inject: [CONFIG],
      useFactory: (config: AppConfig) =>
        config.PAYMENT_PROVIDER === 'asaas' ? new AsaasProvider(config) : new FakePaymentProvider(),
    },
  ],
  exports: [BillingService],
})
export class BillingModule {}
