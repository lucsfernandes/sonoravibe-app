import { Inject, Injectable, Logger } from '@nestjs/common';
import { CreditsLedger } from '@sonora/db';
import { DataSource } from 'typeorm';
import { DATA_SOURCE } from '../database/database.module';

/**
 * A carteira de créditos vista pelo Nest.
 *
 * A lógica está em `CreditsLedger` (@sonora/db) porque o worker também precisa
 * dela para confirmar e estornar; aqui só ligamos a injeção de dependência e o
 * logger do Nest.
 */
@Injectable()
export class CreditsService extends CreditsLedger {
  constructor(@Inject(DATA_SOURCE) dataSource: DataSource) {
    super(dataSource, new Logger(CreditsService.name));
  }
}

export { InsufficientCreditsError, type ReservationSplit } from '@sonora/db';
