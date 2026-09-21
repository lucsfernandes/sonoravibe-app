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
  'nav.playlists': { pt: 'Playlists', en: 'Playlists' },
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
  'criar.cancelada': { pt: 'Cancelada', en: 'Cancelled' },
  'criar.tituloMusica': { pt: 'Título da música', en: 'Song title' },
  'estilos.salvar': { pt: 'Salvar este estilo', en: 'Save this style' },
  'estilos.nome': { pt: 'Nome do estilo', en: 'Style name' },
  'criar.tituloPlaceholder': { pt: 'Estrada até o mar', en: 'Road to the sea' },

  // Biblioteca
  'lib.titulo': { pt: 'Biblioteca', en: 'Library' },
  'lib.vazia': { pt: 'Nada por aqui ainda.', en: 'Nothing here yet.' },
  'lib.vaziaAcao': { pt: 'Crie sua primeira música', en: 'Create your first song' },
  'lib.todas': { pt: 'Todas', en: 'All' },
  'lib.publicas': { pt: 'Públicas', en: 'Public' },
  'lib.privadas': { pt: 'Privadas', en: 'Private' },
  'lib.curtidas': { pt: 'Curtidas', en: 'Liked' },
  'lib.carregarMais': { pt: 'Carregar mais', en: 'Load more' },
  'lib.selecionada': { pt: 'selecionada', en: 'selected' },
  'lib.selecionadas': { pt: 'selecionadas', en: 'selected' },

  // Playlists
  'playlists.titulo': { pt: 'Playlists', en: 'Playlists' },
  'playlists.nome': { pt: 'Nome da playlist', en: 'Playlist name' },
  'playlists.vazia': {
    pt: 'Você ainda não tem playlists. Crie a primeira acima.',
    en: "You don't have any playlists yet. Create your first one above.",
  },
  'playlists.semMusicas': {
    pt: 'Nenhuma música aqui ainda. Adicione pela página de uma música.',
    en: 'No songs here yet. Add them from a song page.',
  },
  'playlists.musica': { pt: 'música', en: 'song' },
  'playlists.musicas': { pt: 'músicas', en: 'songs' },
  'playlists.tocarTudo': { pt: 'Tocar tudo', en: 'Play all' },
  'playlists.adicionar': { pt: 'Adicionar à playlist', en: 'Add to playlist' },
  'playlists.criarCom': { pt: 'Criar playlist nova', en: 'Create new playlist' },
  'playlists.remover': { pt: 'Remover da playlist', en: 'Remove from playlist' },
  'playlists.subir': { pt: 'Mover para cima', en: 'Move up' },
  'playlists.descer': { pt: 'Mover para baixo', en: 'Move down' },
  'musica.tocar': { pt: 'Tocar', en: 'Play' },

  // Edição mecânica — FFmpeg no nosso worker, sem custo de provedor
  'editar.titulo': { pt: 'Editar o áudio', en: 'Edit the audio' },
  'editar.semCusto': { pt: 'sem custo', en: 'free' },
  'editar.aplicar': { pt: 'Aplicar', en: 'Apply' },
  'editar.enfileirada': {
    pt: 'Na fila. A versão editada vai aparecer na sua biblioteca como uma faixa nova — esta continua como está.',
    en: 'Queued. The edited version shows up in your library as a new track — this one stays as it is.',
  },
  'editar.de': { pt: 'De', en: 'From' },
  'editar.ate': { pt: 'Até', en: 'To' },
  'editar.duracaoFade': { pt: 'Duração', en: 'Length' },
  'editar.velocidade': { pt: 'Velocidade', en: 'Speed' },
  'editar.trechoInvertido': {
    pt: 'O fim tem que vir depois do início.',
    en: 'The end must come after the start.',
  },
  'editar.crop': { pt: 'Cortar', en: 'Crop' },
  'editar.crop.dica': {
    pt: 'Mantém só o trecho escolhido e descarta o resto.',
    en: 'Keeps only the chosen part and discards the rest.',
  },
  'editar.trim-silence': { pt: 'Tirar silêncio', en: 'Trim silence' },
  'editar.trim-silence.dica': {
    pt: 'Remove o silêncio do começo e do fim.',
    en: 'Removes silence from the start and the end.',
  },
  'editar.fade-in': { pt: 'Fade de entrada', en: 'Fade in' },
  'editar.fade-in.dica': {
    pt: 'A música começa no silêncio e sobe até o volume normal.',
    en: 'The song starts silent and rises to full volume.',
  },
  'editar.fade-out': { pt: 'Fade de saída', en: 'Fade out' },
  'editar.fade-out.dica': {
    pt: 'O volume cai até o silêncio no fim da faixa.',
    en: 'Volume falls to silence at the end of the track.',
  },
  'editar.speed': { pt: 'Velocidade', en: 'Speed' },
  'editar.speed.dica': {
    pt: 'Acelera ou desacelera sem mudar o tom. De 0,5× a 2×.',
    en: 'Speeds up or slows down without changing pitch. From 0.5× to 2×.',
  },
  'editar.reverse': { pt: 'Reverter', en: 'Reverse' },
  'editar.reverse.dica': {
    pt: 'Toca a faixa de trás para frente.',
    en: 'Plays the track backwards.',
  },
  'editar.normalize': { pt: 'Normalizar', en: 'Normalize' },
  'editar.normalize.dica': {
    pt: 'Ajusta o volume para o padrão de streaming (-14 LUFS).',
    en: 'Sets loudness to the streaming standard (-14 LUFS).',
  },

  // Operações derivadas — chamam o motor e custam crédito
  'derivar.titulo': { pt: 'Criar a partir desta', en: 'Create from this one' },
  'derivar.remix': { pt: 'Remix', en: 'Remix' },
  'derivar.remix.dica': {
    pt: 'Gera uma faixa nova com outro estilo, mantendo a base. A original não muda.',
    en: 'Generates a new track in another style, keeping the base. The original stays.',
  },
  'derivar.trecho': { pt: 'Substituir trecho', en: 'Replace section' },
  'derivar.trecho.dica': {
    pt: 'Regera só o pedaço escolhido. O resto da música continua igual.',
    en: 'Regenerates only the chosen part. The rest stays the same.',
  },
  'derivar.capa': { pt: 'Gerar capa', en: 'Generate cover' },
  'derivar.capa.dica': {
    pt: 'Cria uma imagem de capa. Sem descrição, ela sai do estilo da música.',
    en: 'Creates cover art. With no description, it comes from the song style.',
  },
  'derivar.capaEnfileirada': {
    pt: 'Capa na fila. Ela aparece aqui quando ficar pronta.',
    en: 'Cover queued. It shows up here when it is ready.',
  },
  'derivar.capaPlaceholder': {
    pt: 'quintal à noite, luz quente, violão encostado na parede',
    en: 'backyard at night, warm light, guitar against the wall',
  },
  'derivar.estilosRemix': {
    pt: 'o novo estilo: rock progressivo, guitarra distorcida',
    en: 'the new style: progressive rock, distorted guitar',
  },
  'derivar.estilosTrecho': {
    pt: 'como o trecho deve soar (opcional)',
    en: 'how the section should sound (optional)',
  },
  'lib.baixarSelecionadas': { pt: 'Baixar em lote', en: 'Download as ZIP' },
  'lib.formato': { pt: 'Formato', en: 'Format' },
  'workspaces.novo': { pt: 'Novo workspace', en: 'New workspace' },
  'workspaces.nome': { pt: 'Nome', en: 'Name' },
  'workspaces.duploClique': { pt: 'Clique duas vezes para renomear', en: 'Double-click to rename' },
  'workspaces.confirmarExclusao': {
    pt: 'Excluir o workspace? As músicas continuam na sua biblioteca.',
    en: 'Delete the workspace? The songs stay in your library.',
  },

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
  // Selo numa música só. `lib.privadas` é o filtro da biblioteca, no plural.
  'musica.privada': { pt: 'Privada', en: 'Private' },
  'musica.reproducoes': { pt: 'reproduções', en: 'plays' },
  'musica.reproducao': { pt: 'reprodução', en: 'play' },
  'musica.curtidas': { pt: 'curtidas', en: 'likes' },
  'musica.curtida': { pt: 'curtida', en: 'like' },

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
  // Motivos do extrato. Sem isto o usuário lê o código cru ("generation") na
  // própria fatura dele.
  'motivo.plan_renewal': { pt: 'Renovação do plano', en: 'Plan renewal' },
  'motivo.pack_purchase': { pt: 'Compra de pacote', en: 'Credit pack purchase' },
  'motivo.generation': { pt: 'Geração de música', en: 'Song generation' },
  'motivo.refund': { pt: 'Estorno', en: 'Refund' },
  'motivo.manual_grant': { pt: 'Crédito concedido', en: 'Credit granted' },
  'motivo.expiration': { pt: 'Créditos expirados', en: 'Credits expired' },
  'creditos.planos': { pt: 'Planos', en: 'Plans' },
  'creditos.pacotes': { pt: 'Pacotes avulsos', en: 'Credit packs' },
  'creditos.assinar': { pt: 'Assinar', en: 'Subscribe' },
  'creditos.comprar': { pt: 'Comprar', en: 'Buy' },
  'creditos.planoAtual': { pt: 'Seu plano', en: 'Your plan' },
  'creditos.minPorMusica': { pt: 'min por música', en: 'min per song' },
  'creditos.cancelarAssinatura': { pt: 'Cancelar assinatura', en: 'Cancel subscription' },
  'creditos.confirmarCancelamento': { pt: 'Sim, cancelar', en: 'Yes, cancel' },
  'creditos.manterPlano': { pt: 'Manter', en: 'Keep it' },
  'creditos.canceladaEm': { pt: 'Cancelada em', en: 'Cancelled on' },
  'creditos.avisoCancelamento': {
    pt: 'Você continua com o plano até o fim do período já pago.',
    en: 'You keep the plan until the end of the period you already paid for.',
  },
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
  'auth.entrarDica': {
    pt: 'Suas músicas continuam onde você parou.',
    en: 'Your songs are right where you left them.',
  },
  'auth.nomePlaceholder': { pt: 'Como quer ser chamado', en: 'What should we call you' },
  'auth.senhaMinima': { pt: 'Pelo menos 8 caracteres', en: 'At least 8 characters' },
  'auth.semConta': { pt: 'Ainda não tem conta?', en: "Don't have an account?" },
  'auth.temConta': { pt: 'Já tem conta?', en: 'Already have an account?' },
  'auth.aoCriar': {
    pt: 'Ao criar a conta você concorda com a',
    en: 'By creating an account you agree to the',
  },
  'auth.politica': { pt: 'política de privacidade', en: 'privacy policy' },

  // Coluna de apresentação — só no desktop
  'auth.promessa': {
    pt: 'Descreva a música. O resto é com a gente.',
    en: 'Describe the song. We handle the rest.',
  },
  'auth.ponto1': { pt: '30 créditos por dia', en: '30 credits a day' },
  'auth.ponto1Texto': {
    pt: 'Sem cartão de crédito e sem prazo para acabar.',
    en: 'No credit card, no expiry date.',
  },
  'auth.ponto2': { pt: 'Letra, estilo e instrumentos', en: 'Lyrics, style and instruments' },
  'auth.ponto2Texto': {
    pt: 'Escreva a letra ou peça para a IA escrever. Você escolhe o resto.',
    en: 'Write the lyrics or let the AI write them. You choose the rest.',
  },
  'auth.ponto3': { pt: 'Baixe e use', en: 'Download and use' },
  'auth.ponto3Texto': {
    pt: 'MP3, WAV, FLAC, Opus e AAC. Separe os stems quando precisar.',
    en: 'MP3, WAV, FLAC, Opus and AAC. Split the stems when you need to.',
  },
  'auth.rodape': {
    pt: 'Feito no Brasil. Preços em real.',
    en: 'Made in Brazil. Prices in BRL.',
  },

  // Genéricos
  'geral.salvar': { pt: 'Salvar', en: 'Save' },
  'geral.cancelar': { pt: 'Cancelar', en: 'Cancel' },
  'geral.fechar': { pt: 'Fechar', en: 'Close' },
  'geral.carregando': { pt: 'Carregando...', en: 'Loading...' },
  'geral.erro': { pt: 'Algo deu errado.', en: 'Something went wrong.' },
  'geral.tentarDeNovo': { pt: 'Tentar de novo', en: 'Try again' },
  'geral.opcional': { pt: 'opcional', en: 'optional' },
  'geral.enviando': { pt: 'Enviando...', en: 'Sending...' },
  'geral.excluir': { pt: 'Excluir', en: 'Delete' },
  'geral.criar': { pt: 'Criar', en: 'Create' },
  'geral.voltar': { pt: 'Voltar', en: 'Back' },

  // Curtir e comentar
  'musica.curtir': { pt: 'Curtir', en: 'Like' },
  'musica.descurtir': { pt: 'Descurtir', en: 'Unlike' },
  'comentarios.titulo': { pt: 'Comentários', en: 'Comments' },
  'comentarios.vazio': { pt: 'Nenhum comentário ainda.', en: 'No comments yet.' },
  'comentarios.placeholder': { pt: 'Escreva um comentário', en: 'Write a comment' },
  'comentarios.enviar': { pt: 'Comentar', en: 'Post' },
  'comentarios.marcarInstante': { pt: 'Marcar o instante', en: 'Mark the timestamp' },
  'comentarios.desativados': {
    pt: 'O autor desativou os comentários nesta música.',
    en: 'The author turned off comments on this song.',
  },
  'comentarios.paraComentar': { pt: 'para comentar.', en: 'to comment.' },

  // Gerenciar a própria música
  'gerenciar.titulo': { pt: 'Gerenciar', en: 'Manage' },
  'gerenciar.nome': { pt: 'Nome da música', en: 'Song name' },
  'gerenciar.permitirComentarios': { pt: 'Permitir comentários', en: 'Allow comments' },
  'gerenciar.permitirRemixes': { pt: 'Permitir remixes', en: 'Allow remixes' },
  'gerenciar.excluirMusica': { pt: 'Excluir esta música', en: 'Delete this song' },
  'gerenciar.confirmarExclusao': {
    pt: 'Tem certeza? Ela sai da sua biblioteca.',
    en: 'Are you sure? It leaves your library.',
  },
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
