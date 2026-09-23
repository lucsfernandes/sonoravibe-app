import type { SVGProps } from 'react';

/**
 * Ícones do painel de criação e da biblioteca da aba Criar.
 *
 * Desenhados aqui, em traço de 1.8, e não trazidos de biblioteca: são trinta
 * glifos pequenos, e uma dependência inteira para isso pesaria mais que este
 * arquivo. Todos aceitam `className` para tamanho e cor, e saem com
 * `aria-hidden`: o nome acessível é do botão que os usa, não do desenho.
 */

type Props = SVGProps<SVGSVGElement> & { tamanho?: number };

function Base({ tamanho = 16, children, ...rest }: Props) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

export const MaisIcone = (p: Props) => (
  <Base {...p}>
    <path d="M12 5v14M5 12h14" />
  </Base>
);

export const SetaBaixoIcone = (p: Props) => (
  <Base {...p}>
    <path d="m6 9 6 6 6-6" />
  </Base>
);

export const SetaDireitaIcone = (p: Props) => (
  <Base {...p}>
    <path d="m9 6 6 6-6 6" />
  </Base>
);

export const SetaEsquerdaIcone = (p: Props) => (
  <Base {...p}>
    <path d="m15 6-6 6 6 6" />
  </Base>
);

export const DesfazerIcone = (p: Props) => (
  <Base {...p}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </Base>
);

export const RefazerIcone = (p: Props) => (
  <Base {...p}>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H10a6 6 0 0 0 0 12h3" />
  </Base>
);

export const LapisIcone = (p: Props) => (
  <Base {...p}>
    <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z" />
    <path d="m13.5 6.5 3 3" />
  </Base>
);

export const BibliotecaIcone = (p: Props) => (
  <Base {...p}>
    <path d="M4 5v14M9 5v14M14 6l5 13" />
  </Base>
);

export const ExpandirIcone = (p: Props) => (
  <Base {...p}>
    <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
  </Base>
);

export const RecolherIcone = (p: Props) => (
  <Base {...p}>
    <path d="M10 4v6H4M14 20v-6h6M4 10l6-6M20 14l-6 6" />
  </Base>
);

/** Estrela de quatro pontas com uma menor: o sinal de "feito por IA". */
export const BrilhoIcone = (p: Props) => (
  <Base {...p}>
    <path d="M11 4 12.9 9.1 18 11l-5.1 1.9L11 18l-1.9-5.1L4 11l5.1-1.9z" fill="currentColor" stroke="none" />
    <path d="m18.5 16 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" fill="currentColor" stroke="none" />
  </Base>
);

export const VarinhaIcone = (p: Props) => (
  <Base {...p}>
    <path d="m4 20 10-10" />
    <path d="m14 10 2 2" />
    <path d="M15 3v3M21 9h-3M18 5l-1.5 1.5M11 5h2M6 8v2" />
  </Base>
);

export const EmbaralharIcone = (p: Props) => (
  <Base {...p}>
    <path d="M16 3h5v5" />
    <path d="M4 20 21 3" />
    <path d="M21 16v5h-5" />
    <path d="M15 15l6 6" />
    <path d="M4 4l5 5" />
  </Base>
);

export const LixeiraIcone = (p: Props) => (
  <Base {...p}>
    <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6" />
  </Base>
);

export const BuscaIcone = (p: Props) => (
  <Base {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Base>
);

export const FunilIcone = (p: Props) => (
  <Base {...p}>
    <path d="M3 5h18l-7 8v6l-4 2v-8z" />
  </Base>
);

export const OrdenarIcone = (p: Props) => (
  <Base {...p}>
    <path d="M4 7h16M4 12h10M4 17h5" />
  </Base>
);

export const ListaIcone = (p: Props) => (
  <Base {...p}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <circle cx="5" cy="6" r="1" fill="currentColor" />
    <circle cx="5" cy="12" r="1" fill="currentColor" />
    <circle cx="5" cy="18" r="1" fill="currentColor" />
  </Base>
);

export const OndaIcone = (p: Props) => (
  <Base {...p}>
    <path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M22 12h-1" />
  </Base>
);

export const GradeIcone = (p: Props) => (
  <Base {...p}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
  </Base>
);

export const PolegarIcone = ({ preenchido, ...p }: Props & { preenchido?: boolean }) => (
  <Base {...p} fill={preenchido ? 'currentColor' : 'none'}>
    <path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z" />
    <path d="M7 10l4.5-7a2 2 0 0 1 2 2v4h5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.3 20H7" />
  </Base>
);

export const PlaylistMaisIcone = (p: Props) => (
  <Base {...p}>
    <path d="M4 6h12M4 12h12M4 18h7M18 14v6M15 17h6" />
  </Base>
);

export const GloboIcone = (p: Props) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </Base>
);

export const CadeadoIcone = (p: Props) => (
  <Base {...p}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </Base>
);

export const CompartilharIcone = (p: Props) => (
  <Base {...p}>
    <path d="M14 5l6 6-6 6" />
    <path d="M20 11H10a6 6 0 0 0-6 6v2" />
  </Base>
);

export const PontosIcone = (p: Props) => (
  <Base {...p}>
    <circle cx="6" cy="12" r="1.2" fill="currentColor" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    <circle cx="18" cy="12" r="1.2" fill="currentColor" />
  </Base>
);

export const InfoIcone = (p: Props) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Base>
);

export const RedefinirIcone = (p: Props) => (
  <Base {...p}>
    <path d="M4 10a8 8 0 1 1 2.3 7.7" />
    <path d="M4 4v6h6" />
  </Base>
);

export const NotaIcone = (p: Props) => (
  <Base {...p}>
    <path d="M9 18V5l11-2v13" />
    <circle cx="6.5" cy="18" r="2.5" />
    <circle cx="17.5" cy="16" r="2.5" />
  </Base>
);

export const PastaIcone = (p: Props) => (
  <Base {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Base>
);

export const MicrofoneIcone = (p: Props) => (
  <Base {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
  </Base>
);

export const EnviarIcone = (p: Props) => (
  <Base {...p}>
    <path d="M12 16V4M6 10l6-6 6 6" />
    <path d="M4 20h16" />
  </Base>
);

export const FecharIcone = (p: Props) => (
  <Base {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Base>
);

export const ConfirmarIcone = (p: Props) => (
  <Base {...p}>
    <path d="m5 12 5 5L20 7" />
  </Base>
);

export const TocarIcone = (p: Props) => (
  <Base {...p} fill="currentColor" stroke="none">
    <path d="M8 5.5v13l11-6.5z" />
  </Base>
);

export const PausarIcone = (p: Props) => (
  <Base {...p} fill="currentColor" stroke="none">
    <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
  </Base>
);

export const ProibidoIcone = (p: Props) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m6 6 12 12" />
  </Base>
);

export const BaixarIcone = (p: Props) => (
  <Base {...p}>
    <path d="M12 4v12M6 10l6 6 6-6M4 20h16" />
  </Base>
);

export const AbrirIcone = (p: Props) => (
  <Base {...p}>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
  </Base>
);

export const CarregandoIcone = (p: Props) => (
  <Base {...p} className={`animate-spin ${p.className ?? ''}`}>
    <path d="M12 3a9 9 0 1 0 9 9" />
  </Base>
);

// --- Player -----------------------------------------------------------------

export const AnteriorIcone = (p: Props) => (
  <Base {...p} fill="currentColor" stroke="none">
    <path d="M18 6v12l-9-6zM5 6h2v12H5z" />
  </Base>
);

export const ProximoIcone = (p: Props) => (
  <Base {...p} fill="currentColor" stroke="none">
    <path d="M6 6v12l9-6zM17 6h2v12h-2z" />
  </Base>
);

export const RepetirIcone = (p: Props) => (
  <Base {...p}>
    <path d="M17 2l4 4-4 4" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <path d="M7 22l-4-4 4-4" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </Base>
);

/** Repetir só esta: o mesmo laço com um "1" no meio. */
export const RepetirUmaIcone = (p: Props) => (
  <Base {...p}>
    <path d="M17 2l4 4-4 4" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <path d="M7 22l-4-4 4-4" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    <path d="M11 10l2-1v6" />
  </Base>
);

export const VolumeIcone = ({ mudo, ...p }: Props & { mudo?: boolean }) => (
  <Base {...p}>
    <path d="M4 9v6h3.5L12 19V5L7.5 9z" />
    {mudo ? (
      <path d="M16 9l5 6M21 9l-5 6" />
    ) : (
      <path d="M16 9.5a3.5 3.5 0 0 1 0 5M18.5 7a7 7 0 0 1 0 10" />
    )}
  </Base>
);

export const FilaIcone = (p: Props) => (
  <Base {...p}>
    <path d="M4 6h10M4 12h10M4 18h16" />
    <path d="M17 6l4 3-4 3z" fill="currentColor" stroke="none" />
  </Base>
);

export const ComentarioIcone = (p: Props) => (
  <Base {...p}>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 4z" />
  </Base>
);

export const CopiarIcone = (p: Props) => (
  <Base {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
  </Base>
);

export const RemixIcone = (p: Props) => (
  <Base {...p}>
    <path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.5" />
    <path d="M20 4v4.5h-4.5" />
    <path d="M20 12a8 8 0 0 1-13.7 5.7L4 15.5" />
    <path d="M4 20v-4.5h4.5" />
  </Base>
);
