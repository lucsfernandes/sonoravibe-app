import { Module } from '@nestjs/common';
import { CreditsModule } from '../credits/credits.module';
import { PlanRenewalService } from './plan-renewal.service';
import { PlansRepository } from './plans.repository';
import { PlansService } from './plans.service';

@Module({
  imports: [CreditsModule],
  providers: [PlansService, PlansRepository, PlanRenewalService],
  exports: [PlansService, PlansRepository, PlanRenewalService],
})
export class PlansModule {}
