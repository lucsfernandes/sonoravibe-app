/**
 * Foto do usuário, ou a inicial do nome sobre o gradiente da marca quando
 * não há foto. É o mesmo desenho no menu da barra lateral, no submenu, na
 * edição do perfil e na barra inferior do celular.
 */
export function Avatar({
  url,
  nome,
  tamanho = 36,
  className = '',
}: {
  url: string | null | undefined;
  nome: string;
  tamanho?: number;
  className?: string;
}) {
  const estilo = { width: tamanho, height: tamanho, fontSize: Math.round(tamanho * 0.42) };
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- URL assinada do R2 ou foto do Google
      <img
        src={url}
        alt=""
        style={estilo}
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={estilo}
      className={`flex shrink-0 items-center justify-center rounded-full gradiente-acento font-black text-white ${className}`}
    >
      {nome.trim().slice(0, 1).toUpperCase() || '?'}
    </span>
  );
}
