import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { StylePreset } from '@sonora/db';
import { DataSource } from 'typeorm';
import { DATA_SOURCE } from '../database/database.module';

/** Estilos salvos pelo usuário para reaproveitar entre gerações. */
@Injectable()
export class StylesService {
  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource) {}

  list(userId: string): Promise<StylePreset[]> {
    return this.dataSource
      .getRepository(StylePreset)
      .find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  create(
    userId: string,
    data: { name: string; prompt: string; excludeStyles?: string },
  ): Promise<StylePreset> {
    const repo = this.dataSource.getRepository(StylePreset);
    return repo.save(
      repo.create({
        userId,
        name: data.name,
        prompt: data.prompt,
        excludeStyles: data.excludeStyles ?? null,
      }),
    );
  }

  async remove(userId: string, id: string): Promise<void> {
    const { affected } = await this.dataSource
      .getRepository(StylePreset)
      .delete({ id, userId });
    if (!affected) throw new NotFoundException('Estilo não encontrado.');
  }
}
