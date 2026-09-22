'use client';

import { useRef, useState } from 'react';
import { Modal } from '@/components/criar/modal';
import { ApiError, api, enviarAvatar } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSessao } from '@/lib/sessao';
import { Avatar } from './avatar';

/** Lado maior da foto depois de reduzida. 512px cobre qualquer avatar da interface com sobra. */
const LADO_MAXIMO = 512;

/**
 * Edição do próprio perfil: foto, nome e bio.
 *
 * A foto é reduzida no navegador antes de subir: uma foto de celular tem
 * 4000px e 5 MB, e o avatar nunca passa de 80px na tela. Mandar o arquivo
 * inteiro gastaria banda e armazenamento para nada, e a API recusaria os
 * maiores. Nome e bio só vão para o servidor no Salvar; a foto sobe na hora,
 * porque é o que a pessoa espera ao escolher um arquivo.
 */
export function EditarPerfil({ aoFechar }: { aoFechar: () => void }) {
  const { t } = useI18n();
  const { usuario, perfil, recarregarPerfil } = useSessao();
  const entrada = useRef<HTMLInputElement>(null);

  const [nome, setNome] = useState(perfil?.displayName ?? usuario?.name ?? '');
  const [bio, setBio] = useState(perfil?.bio ?? '');
  const [fotoUrl, setFotoUrl] = useState<string | null>(perfil?.avatarUrl ?? null);
  const [ocupado, setOcupado] = useState<'foto' | 'salvar' | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  async function trocarFoto(lista: FileList | null) {
    const arquivo = lista?.[0];
    if (!arquivo) return;
    setOcupado('foto');
    setErro(null);
    try {
      const reduzida = await reduzirImagem(arquivo);
      const { avatarUrl } = await enviarAvatar(reduzida);
      setFotoUrl(avatarUrl);
      await recarregarPerfil();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : t('geral.erro'));
    } finally {
      setOcupado(null);
      if (entrada.current) entrada.current.value = '';
    }
  }

  async function removerFoto() {
    setOcupado('foto');
    setErro(null);
    try {
      await api.delete('/me/avatar');
      setFotoUrl(null);
      await recarregarPerfil();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : t('geral.erro'));
    } finally {
      setOcupado(null);
    }
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const limpo = nome.trim();
    if (!limpo) return;
    setOcupado('salvar');
    setErro(null);
    try {
      await api.patch('/me', { name: limpo, bio: bio.trim() || null });
      await recarregarPerfil();
      setSalvo(true);
      setTimeout(aoFechar, 700);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : t('geral.erro'));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <Modal titulo={t('perfil.editar')} aoFechar={aoFechar} largura="max-w-md">
      <form onSubmit={salvar} className="space-y-5 p-5">
        <div className="flex items-center gap-4">
          <Avatar url={fotoUrl} nome={nome || '?'} tamanho={72} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{t('perfil.foto')}</p>
            <p className="mt-0.5 text-xs text-texto-fraco">{t('perfil.fotoDica')}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => entrada.current?.click()}
                disabled={ocupado !== null}
                className="rounded-full border border-borda px-3.5 py-1.5 text-xs font-medium transition-colors hover:border-acento hover:text-acento disabled:opacity-40"
              >
                {ocupado === 'foto' ? t('geral.enviando') : t('perfil.trocarFoto')}
              </button>
              {fotoUrl && (
                <button
                  type="button"
                  onClick={() => void removerFoto()}
                  disabled={ocupado !== null}
                  className="rounded-full px-3 py-1.5 text-xs text-texto-suave transition-colors hover:text-perigo disabled:opacity-40"
                >
                  {t('perfil.removerFoto')}
                </button>
              )}
            </div>
            <input
              ref={entrada}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              aria-label={t('perfil.trocarFoto')}
              onChange={(e) => void trocarFoto(e.target.files)}
            />
          </div>
        </div>

        <div>
          <label htmlFor="perfil-nome" className="mb-1.5 block text-xs font-medium text-texto-suave">
            {t('perfil.nome')}
          </label>
          <input
            id="perfil-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            maxLength={80}
            required
            className="w-full rounded-xl border border-borda bg-fundo px-3 py-2.5 text-sm outline-none focus:border-acento"
          />
          {perfil?.handle && <p className="mt-1 text-xs text-texto-fraco">@{perfil.handle}</p>}
        </div>

        <div>
          <label htmlFor="perfil-bio" className="mb-1.5 block text-xs font-medium text-texto-suave">
            {t('perfil.bio')}
          </label>
          <textarea
            id="perfil-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder={t('perfil.bioPlaceholder')}
            maxLength={500}
            rows={3}
            className="w-full resize-none rounded-xl border border-borda bg-fundo px-3 py-2.5 text-sm outline-none placeholder:text-texto-fraco focus:border-acento"
          />
        </div>

        {erro && (
          <p role="alert" className="text-sm text-perigo">
            {erro}
          </p>
        )}
        {salvo && <p className="text-sm text-sucesso">{t('perfil.salvo')}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={aoFechar}
            className="rounded-xl px-4 py-2.5 text-sm text-texto-suave transition-colors hover:text-texto"
          >
            {t('geral.cancelar')}
          </button>
          <button
            type="submit"
            disabled={ocupado !== null || !nome.trim()}
            className="rounded-xl gradiente-acento px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            {ocupado === 'salvar' ? t('geral.enviando') : t('geral.salvar')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Reduz a imagem para caber em LADO_MAXIMO e reencoda como JPEG.
 *
 * `imageOrientation: 'from-image'` aplica a rotação gravada pela câmera:
 * sem isso, foto tirada no celular em pé chega deitada. Navegador sem
 * `createImageBitmap` manda o arquivo original, e a API limita o tamanho.
 */
async function reduzirImagem(arquivo: File): Promise<Blob> {
  if (typeof createImageBitmap !== 'function') return arquivo;
  try {
    const bitmap = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
    const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height));
    const largura = Math.max(1, Math.round(bitmap.width * escala));
    const altura = Math.max(1, Math.round(bitmap.height * escala));
    const canvas = document.createElement('canvas');
    canvas.width = largura;
    canvas.height = altura;
    const ctx = canvas.getContext('2d');
    if (!ctx) return arquivo;
    ctx.drawImage(bitmap, 0, 0, largura, altura);
    bitmap.close();
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Não consegui reduzir a imagem.'))),
        'image/jpeg',
        0.86,
      ),
    );
  } catch {
    return arquivo;
  }
}
