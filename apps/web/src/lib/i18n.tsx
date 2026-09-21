'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Tradução PT-BR / EN.
 *
 * Um dicionário e um contexto, sem biblioteca: são duas línguas e algumas
 * centenas de chaves. `next-intl` ou `i18next` trariam roteamento por locale,
 * negociação de servidor e formatadores que este produto não usa — e cada um
 * deles custa dependência, configuração e uma curva para quem mexer depois.
 *
 * A escolha fica em cookie, para o servidor renderizar já no idioma certo.
 */

export const LOCALES = ['pt', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_COOKIE = 'sonora_locale';

type Dicionario = Record<string, { pt: string; en: string }>;

const T: Dicionario = {
  // Navegação
  'nav.inicio': { pt: 'Início', en: 'Home' },
  'nav.explorar': { pt: 'Explorar', en: 'Explore' },
  'nav.criar': { pt: 'Criar', en: 'Create' },
  'nav.biblioteca': { pt: 'Biblioteca', en: 'Library' },
  'nav.creditos': { pt: 'Créditos', en: 'Credits' },
  'nav.entrar': { pt: 'Entrar', en: 'Sign in' },
  'nav.sair': { pt: 'Sair', en: 'Sign out' },
  'nav.upgrade': { pt: 'Assinar o Premier', en: 'Upgrade to Premier' },

  // Home
  'home.titulo': { pt: 'Ouça sua ideia como nunca antes', en: 'Hear your vision like never before' },
  'home.placeholder': {
    pt: 'Descreva a música que você quer criar',
    en: 'Describe the song you want to make',
  },
  'home.destaques': { pt: 'Em alta agora', en: 'Trending now' },
  'home.recentes': { pt: 'Suas últimas criações', en: 'Your latest creations' },

  // Criação
  'criar.titulo': { pt: 'Criar', en: 'Create' },
  'criar.simples': { pt: 'Simples', en: 'Simple' },
  'criar.avancado': { pt: 'Avançado', en: 'Advanced' },
  'criar.sons': { pt: 'Sons', en: 'Sounds' },
  'criar.descricao': { pt: 'Descrição', en: 'Description' },
  'criar.letra': { pt: 'Letra', en: 'Lyrics' },
  'criar.letraPlaceholder': {
    pt: '[Verse]\nEscreva sua letra aqui\n\n[Chorus]\nOu peça para a IA escrever',
    en: '[Verse]\nWrite your lyrics here\n\n[Chorus]\nOr let the AI write them',
  },
  'criar.escreverComIA': { pt: 'Escrever com IA', en: 'Write with AI' },
  'criar.estilos': { pt: 'Estilos', en: 'Styles' },
  'criar.estilosPlaceholder': {
    pt: 'pop rock brasileiro, violão, bateria ao vivo',
    en: 'indie pop, acoustic guitar, live drums',
  },
  'criar.excluir': { pt: 'Excluir estilos', en: 'Exclude styles' },
  'criar.excluirPlaceholder': { pt: 'distorção, autotune', en: 'distortion, autotune' },
  'criar.maisOpcoes': { pt: 'Mais opções', en: 'More options' },
  'criar.instrumental': { pt: 'Instrumental', en: 'Instrumental' },
  'criar.voz': { pt: 'Voz', en: 'Vocals' },
  'criar.vozQualquer': { pt: 'Qualquer', en: 'Any' },
  'criar.vozMasculina': { pt: 'Masculina', en: 'Male' },
  'criar.vozFeminina': { pt: 'Feminina', en: 'Female' },
  'criar.duracao': { pt: 'Duração', en: 'Duration' },
  'criar.duracaoAuto': { pt: 'Automática', en: 'Automatic' },
  'criar.duracaoDica': {
    pt: 'Deixar automática costuma soar mais natural: o modelo ajusta a estrutura ao tamanho da letra.',
    en: 'Automatic usually sounds more natural: the model fits the structure to the lyrics.',
  },
  'criar.bpm': { pt: 'Andamento (BPM)', en: 'Tempo (BPM)' },
  'criar.tom': { pt: 'Tom', en: 'Key' },
  'criar.estranheza': { pt: 'Estranheza', en: 'Weirdness' },
  'criar.aderencia': { pt: 'Aderência ao estilo', en: 'Style influence' },
  'criar.maxMode': { pt: 'Max Mode (até 8 min)', en: 'Max Mode (up to 8 min)' },
  'criar.tipoSom': { pt: 'Tipo', en: 'Type' },
  'criar.oneShot': { pt: 'One-shot', en: 'One-shot' },
  'criar.loop': { pt: 'Loop', en: 'Loop' },
  'criar.salvarEm': { pt: 'Salvar em', en: 'Save to' },
  'criar.botao': { pt: 'Criar', en: 'Create' },
  'criar.criando': { pt: 'Criando...', en: 'Creating...' },
  'criar.custo': { pt: 'créditos', en: 'credits' },
  'criar.sortear': { pt: 'Sortear estilo', en: 'Random style' },

  // Biblioteca
  'lib.titulo': { pt: 'Biblioteca', en: 'Library' },
  'lib.vazia': { pt: 'Nada por aqui ainda.', en: 'Nothing here yet.' },
  'lib.vaziaAcao': { pt: 'Crie sua primeira música', en: 'Create your first song' },
  'lib.todas': { pt: 'Todas', en: 'All' },
  'lib.publicas': { pt: 'Públicas', en: 'Public' },
  'lib.privadas': { pt: 'Privadas', en: 'Private' },
  'lib.curtidas': { pt: 'Curtidas', en: 'Liked' },
  'lib.carregarMais': { pt: 'Carregar mais', en: 'Load more' },

  // Música
  'musica.baixar': { pt: 'Baixar', en: 'Download' },
  'musica.publicar': { pt: 'Publicar', en: 'Publish' },
  'musica.despublicar': { pt: 'Tornar privada', en: 'Make private' },
  'musica.estender': { pt: 'Estender', en: 'Extend' },
  'musica.remix': { pt: 'Remix', en: 'Remix' },
  'musica.stems': { pt: 'Separar stems', en: 'Split stems' },
  'musica.excluir': { pt: 'Excluir', en: 'Delete' },
  'musica.convertendo': { pt: 'Convertendo...', en: 'Converting...' },
  'musica.somenteePagos': { pt: 'Exclusivo dos planos pagos', en: 'Paid plans only' },

  // Explorar
  'explorar.titulo': { pt: 'Explorar', en: 'Explore' },
  'explorar.emAlta': { pt: 'Em alta', en: 'Trending' },
  'explorar.novas': { pt: 'Novas', en: 'New' },
  'explorar.seguindo': { pt: 'Seguindo', en: 'Following' },
  'explorar.seguindoVazio': {
    pt: 'Você ainda não segue ninguém.',
    en: "You're not following anyone yet.",
  },

  // Créditos
  'creditos.titulo': { pt: 'Créditos e plano', en: 'Credits and plan' },
  'creditos.saldo': { pt: 'Saldo', en: 'Balance' },
  'creditos.doPlano': { pt: 'do plano', en: 'from plan' },
  'creditos.avulsos': { pt: 'avulsos', en: 'packs' },
  'creditos.extrato': { pt: 'Extrato', en: 'History' },
  'creditos.planos': { pt: 'Planos', en: 'Plans' },
  'creditos.pacotes': { pt: 'Pacotes avulsos', en: 'Credit packs' },
  'creditos.assinar': { pt: 'Assinar', en: 'Subscribe' },
  'creditos.comprar': { pt: 'Comprar', en: 'Buy' },
  'creditos.planoAtual': { pt: 'Seu plano', en: 'Your plan' },
  'creditos.porMes': { pt: '/mês', en: '/month' },
  'creditos.validade': { pt: 'Válidos por 12 meses', en: 'Valid for 12 months' },

  // Autenticação
  'auth.entrar': { pt: 'Entrar', en: 'Sign in' },
  'auth.criarConta': { pt: 'Criar conta', en: 'Create account' },
  'auth.nome': { pt: 'Nome', en: 'Name' },
  'auth.email': { pt: 'E-mail', en: 'Email' },
  'auth.senha': { pt: 'Senha', en: 'Password' },
  'auth.jaTenhoConta': { pt: 'Já tenho conta', en: 'I already have an account' },
  'auth.naoTenhoConta': { pt: 'Criar uma conta', en: 'Create an account' },
  'auth.bemVindo': { pt: 'Bem-vindo de volta', en: 'Welcome back' },
  'auth.comece': { pt: 'Comece a criar', en: 'Start creating' },
  'auth.comeceDica': {
    pt: 'Conta nova ganha 30 créditos por dia, sem cartão.',
    en: 'New accounts get 30 credits a day, no card needed.',
  },

  // Genéricos
  'geral.salvar': { pt: 'Salvar', en: 'Save' },
  'geral.cancelar': { pt: 'Cancelar', en: 'Cancel' },
  'geral.fechar': { pt: 'Fechar', en: 'Close' },
  'geral.carregando': { pt: 'Carregando...', en: 'Loading...' },
  'geral.erro': { pt: 'Algo deu errado.', en: 'Something went wrong.' },
  'geral.tentarDeNovo': { pt: 'Tentar de novo', en: 'Try again' },
  'geral.opcional': { pt: 'opcional', en: 'optional' },
};

interface I18n {
  locale: Locale;
  t: (chave: keyof typeof T | string) => string;
  setLocale: (locale: Locale) => void;
}

const Contexto = createContext<I18n | null>(null);

export function I18nProvider({
  children,
  inicial,
}: {
  children: ReactNode;
  inicial: Locale;
}) {
  const [locale, setLocaleEstado] = useState<Locale>(inicial);

  const setLocale = useCallback((novo: Locale) => {
    setLocaleEstado(novo);
    // Um ano: a escolha de idioma não precisa ser refeita a cada visita.
    document.cookie = `${LOCALE_COOKIE}=${novo}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  const valor = useMemo<I18n>(
    () => ({
      locale,
      setLocale,
      t: (chave) => {
        const entrada = T[chave as string];
        // Chave sem tradução aparece como está, em vez de virar texto vazio:
        // um rótulo estranho é um bug visível; um vazio passa despercebido.
        if (!entrada) return String(chave);
        return entrada[locale];
      },
    }),
    [locale, setLocale],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useI18n(): I18n {
  const contexto = useContext(Contexto);
  if (!contexto) throw new Error('useI18n precisa estar dentro de <I18nProvider>.');
  return contexto;
}

/** Formata milissegundos como m:ss, para durações de faixa. */
export function formatarDuracao(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Abrevia contagens grandes: 12.400 vira "12,4 mil". */
export function formatarContagem(n: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === 'pt' ? 'pt-BR' : 'en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);
}
