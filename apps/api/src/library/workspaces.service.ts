import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Song, Workspace } from '@sonora/db';
import { DataSource } from 'typeorm';
import { DATA_SOURCE } from '../database/database.module';

/** Pastas de organização da biblioteca — o "Workspace" do Suno. */
@Injectable()
export class WorkspacesService {
  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource) {}

  /**
   * Os workspaces do usuário, com quantas músicas cada um tem.
   *
   * `songCount` é CALCULADO aqui, não guardado na linha. A coluna existia na
   * entidade e nunca era escrita por ninguém: nenhum increment, nenhum update.
   * Ficava 0 para sempre, e a biblioteca mostrava pasta vazia com música
   * dentro.
   *
   * Consertar mantendo o contador exigiria acertar quatro caminhos de escrita
   * (criar música, apagar, mover entre workspaces, restaurar da lixeira) e
   * torcer para nenhum divergir. Um contador desviado é invisível até alguém
   * reparar. Aqui um GROUP BY resolve e nunca mente, e o custo é desprezível:
   * um usuário tem um punhado de pastas, não milhares.
   *
   * O `deletedAt IS NULL` importa: a exclusão é lógica, e uma música na
   * lixeira não deve contar como se estivesse na pasta.
   */
  async list(userId: string): Promise<Workspace[]> {
    const workspaces = await this.dataSource.getRepository(Workspace).find({
      where: { userId },
      // O padrão sempre primeiro; depois, mais recentes no topo.
      order: { isDefault: 'DESC', createdAt: 'DESC' },
    });

    if (workspaces.length === 0) return workspaces;

    const contagens = await this.dataSource
      .getRepository(Song)
      .createQueryBuilder('song')
      .select('song.workspaceId', 'workspaceId')
      .addSelect('COUNT(*)', 'total')
      .where('song.userId = :userId', { userId })
      .andWhere('song.workspaceId IN (:...ids)', { ids: workspaces.map((w) => w.id) })
      .andWhere('song.deletedAt IS NULL')
      .groupBy('song.workspaceId')
      .getRawMany<{ workspaceId: string; total: string }>();

    const porId = new Map(contagens.map((c) => [c.workspaceId, Number(c.total)]));
    for (const w of workspaces) w.songCount = porId.get(w.id) ?? 0;

    return workspaces;
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
