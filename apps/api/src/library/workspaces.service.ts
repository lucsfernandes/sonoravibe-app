import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Song, Workspace } from '@sonora/db';
import { DataSource } from 'typeorm';
import { DATA_SOURCE } from '../database/database.module';

/** Pastas de organização da biblioteca — o "Workspace" do Suno. */
@Injectable()
export class WorkspacesService {
  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource) {}

  async list(userId: string): Promise<Workspace[]> {
    return this.dataSource.getRepository(Workspace).find({
      where: { userId },
      // O padrão sempre primeiro; depois, mais recentes no topo.
      order: { isDefault: 'DESC', createdAt: 'DESC' },
    });
  }

  async create(userId: string, name: string): Promise<Workspace> {
    const repo = this.dataSource.getRepository(Workspace);
    return repo.save(repo.create({ userId, name, isDefault: false }));
  }

  async rename(userId: string, id: string, name: string): Promise<Workspace> {
    const workspace = await this.own(userId, id);
    workspace.name = name;
    return this.dataSource.getRepository(Workspace).save(workspace);
  }

  /**
   * Apaga a pasta, não as músicas: elas voltam para "sem workspace" pela FK
   * (ON DELETE SET NULL). Apagar a pasta e levar a biblioteca junto seria uma
   * perda irreversível a um clique de distância.
   */
  async remove(userId: string, id: string): Promise<void> {
    const workspace = await this.own(userId, id);
    if (workspace.isDefault) {
      throw new ForbiddenException('O workspace padrão não pode ser excluído.');
    }
    await this.dataSource.getRepository(Song).update(
      { workspaceId: workspace.id },
      { workspaceId: null },
    );
    await this.dataSource.getRepository(Workspace).delete({ id: workspace.id });
  }

  private async own(userId: string, id: string): Promise<Workspace> {
    const workspace = await this.dataSource
      .getRepository(Workspace)
      .findOneBy({ id, userId });
    if (!workspace) throw new NotFoundException('Workspace não encontrado.');
    return workspace;
  }
}
