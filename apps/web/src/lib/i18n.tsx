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
  'nav.recolherMenu': { pt: 'Recolher o menu', en: 'Collapse the menu' },
  'nav.expandirMenu': { pt: 'Expandir o menu', en: 'Expand the menu' },
  'nav.entrar': { pt: 'Entrar', en: 'Sign in' },
  'nav.sair': { pt: 'Sair', en: 'Sign out' },
  'nav.upgrade': { pt: 'Assinar o Premier', en: 'Upgrade to Premier' },
  'nav.menuUsuario': { pt: 'Opções da conta', en: 'Account options' },
  'nav.idioma': { pt: 'Idioma', en: 'Language' },

  // Menu do usuário e edição do perfil
  'perfil.ver': { pt: 'Ver perfil', en: 'View profile' },
  'perfil.editar': { pt: 'Editar perfil', en: 'Edit profile' },
  'perfil.nome': { pt: 'Nome', en: 'Name' },
  'perfil.bio': { pt: 'Bio', en: 'Bio' },
  'perfil.bioPlaceholder': {
    pt: 'Uma linha sobre você e o que você cria',
    en: 'A line about you and what you make',
  },
  'perfil.foto': { pt: 'Foto de perfil', en: 'Profile photo' },
  'perfil.trocarFoto': { pt: 'Trocar foto', en: 'Change photo' },
  'perfil.removerFoto': { pt: 'Remover foto', en: 'Remove photo' },
  'perfil.fotoDica': { pt: 'JPEG, PNG ou WebP. A imagem é reduzida antes de subir.', en: 'JPEG, PNG or WebP. The image is scaled down before upload.' },
  'perfil.salvo': { pt: 'Perfil salvo.', en: 'Profile saved.' },

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
  'criar.maxMode': { pt: 'Max Mode (até 6 min)', en: 'Max Mode (up to 6 min)' },
  'criar.tipoSom': { pt: 'Tipo', en: 'Type' },
  'criar.oneShot': { pt: 'One-shot', en: 'One-shot' },
  'criar.loop': { pt: 'Loop', en: 'Loop' },
  'criar.salvarEm': { pt: 'Salvar em', en: 'Save to' },
  'criar.botao': { pt: 'Criar', en: 'Create' },
  'criar.criando': { pt: 'Criando...', en: 'Creating...' },
  'criar.custo': { pt: 'créditos', en: 'credits' },
  'criar.custoUm': { pt: 'crédito', en: 'credit' },
  'criar.sortear': { pt: 'Sortear estilo', en: 'Random style' },
  'criar.cancelada': { pt: 'Cancelada', en: 'Cancelled' },
  'criar.tituloMusica': { pt: 'Título da música', en: 'Song title' },
  'estilos.salvar': { pt: 'Salvar este estilo', en: 'Save this style' },
  'estilos.nome': { pt: 'Nome do estilo', en: 'Style name' },
  'criar.tituloPlaceholder': { pt: 'Estrada até o mar', en: 'Road to the sea' },

  // Painel de criação (referência visual do Suno): cabeçalho, referências e cartões
  'criar.audio': { pt: 'Áudio', en: 'Audio' },
  'criar.inspiracao': { pt: 'Inspiração', en: 'Inspo' },
  'criar.descricaoTitulo': { pt: 'Descrição da música', en: 'Song description' },
  'criar.letraVazia': {
    pt: 'Comece a escrever a letra, ou deixe vazio para instrumental',
    en: 'Start writing lyrics, or leave this empty for instrumental',
  },
  'criar.desfazer': { pt: 'Desfazer', en: 'Undo' },
  'criar.refazer': { pt: 'Refazer', en: 'Redo' },
  'criar.expandir': { pt: 'Expandir', en: 'Expand' },
  'criar.recolher': { pt: 'Recolher', en: 'Collapse' },
  'criar.estrutura': { pt: 'Inserir seção', en: 'Insert section' },
  'criar.limpar': { pt: 'Limpar', en: 'Clear' },
  'criar.temaLetra': { pt: 'Sobre o que é a música?', en: 'What is the song about?' },
  'criar.gerarLetra': { pt: 'Gerar letra com IA', en: 'Generate lyrics with AI' },
  'criar.aprimorar': { pt: 'Aprimorar com IA', en: 'Enhance with AI' },
  'criar.estilosSalvos': { pt: 'Estilos salvos', en: 'Saved styles' },
  'criar.sugestoes': { pt: 'Sugestões', en: 'Suggestions' },
  'criar.vozDica': {
    pt: 'Timbre do vocal principal. Sem escolha, o modelo decide.',
    en: 'Lead vocal timbre. With no choice, the model decides.',
  },
  'criar.auto': { pt: 'Auto', en: 'Auto' },
  'criar.maxModeCurto': { pt: 'Max Mode', en: 'Max Mode' },
  'criar.maxModeDica': {
    pt: 'Libera músicas de até 6 minutos. Exclusivo do plano Premier.',
    en: 'Unlocks songs up to 6 minutes. Premier plan only.',
  },
  'criar.estranhezaDica': {
    pt: 'Quanto o modelo pode fugir do previsível: 0 é convencional, 100 é experimental.',
    en: 'How far the model may stray from the expected: 0 is conventional, 100 is experimental.',
  },
  'criar.aderenciaCurto': { pt: 'Aderência', en: 'Style Influence' },
  'criar.aderenciaDica': {
    pt: 'Quanto o modelo segue à risca o estilo descrito.',
    en: 'How strictly the model follows the described style.',
  },
  'criar.variedade': { pt: 'Variedade', en: 'Variety' },
  'criar.variedadeDica': {
    pt: 'Quão diferentes ficam as versões geradas do mesmo pedido.',
    en: 'How different the generated takes of the same request turn out.',
  },
  'criar.variedadeBaixa': { pt: 'Baixa', en: 'Low' },
  'criar.variedadeMedia': { pt: 'Média', en: 'Medium' },
  'criar.variedadeAlta': { pt: 'Alta', en: 'High' },
  'criar.personalizar': { pt: 'Personalizar', en: 'Personalize' },
  'criar.meuGosto': { pt: 'Meu gosto', en: 'My Taste' },
  'criar.personalizarDica': {
    pt: 'Usa o que você já curtiu para enviesar o resultado.',
    en: 'Uses what you already liked to bias the result.',
  },
  'criar.ligado': { pt: 'On', en: 'On' },
  'criar.desligado': { pt: 'Off', en: 'Off' },
  'criar.redefinir': { pt: 'Redefinir', en: 'Reset' },
  'criar.tituloOpcional': { pt: 'Título da música (opcional)', en: 'Song Title (Optional)' },
  'criar.salvarEmDots': { pt: 'Salvar em...', en: 'Save to...' },
  'criar.limparTudo': { pt: 'Limpar tudo', en: 'Clear all' },
  'criar.referenciaAudio': { pt: 'Áudio de referência', en: 'Reference audio' },
  'criar.referenciaProcessando': { pt: 'Processando o áudio…', en: 'Processing audio…' },
  'criar.referenciaDica': {
    pt: 'O motor ouve esta faixa e mantém a estrutura dela ao aplicar o estilo novo.',
    en: 'The engine listens to this track and keeps its structure while applying the new style.',
  },
  'criar.remover': { pt: 'Remover', en: 'Remove' },
  'criar.abaBiblioteca': { pt: 'Minhas músicas', en: 'My songs' },
  'criar.abaPublicas': { pt: 'Públicas', en: 'Public' },
  'criar.abaEnviar': { pt: 'Enviar arquivo', en: 'Upload file' },
  'criar.abaGravar': { pt: 'Gravar', en: 'Record' },
  'criar.buscarMusica': { pt: 'Buscar por título ou estilo', en: 'Search by title or style' },
  'criar.usar': { pt: 'Usar', en: 'Use' },
  'criar.nenhumaEncontrada': { pt: 'Nenhuma música encontrada.', en: 'No songs found.' },
  'criar.soltarArquivo': {
    pt: 'Arraste um áudio aqui ou clique para escolher',
    en: 'Drop an audio file here or click to choose',
  },
  'criar.formatosAceitos': {
    pt: 'MP3, WAV, FLAC, OGG, Opus ou M4A, até 60 MB.',
    en: 'MP3, WAV, FLAC, OGG, Opus or M4A, up to 60 MB.',
  },
  'criar.enviandoArquivo': { pt: 'Enviando…', en: 'Uploading…' },
  'criar.gravar': { pt: 'Gravar', en: 'Record' },
  'criar.parar': { pt: 'Parar', en: 'Stop' },
  'criar.regravar': { pt: 'Gravar de novo', en: 'Record again' },
  'criar.usarGravacao': { pt: 'Usar esta gravação', en: 'Use this recording' },
  'criar.gravarDica': {
    pt: 'Cante, assobie ou toque uma ideia. O motor usa a gravação como base.',
    en: 'Sing, whistle or play an idea. The engine uses the recording as the base.',
  },
  'criar.microfoneNegado': {
    pt: 'Não consegui acessar o microfone. Confira a permissão do navegador.',
    en: 'Could not access the microphone. Check the browser permission.',
  },
  'criar.inspiracaoTitulo': { pt: 'Playlist de inspiração', en: 'Inspiration playlist' },
  'criar.inspiracaoDica': {
    pt: 'Os estilos das faixas da playlist entram no prompt como referência.',
    en: 'The styles of the playlist tracks go into the prompt as a reference.',
  },
  'criar.semPlaylists': { pt: 'Você ainda não tem playlists.', en: "You don't have any playlists yet." },

  // Biblioteca da aba Criar
  'lib.workspaces': { pt: 'Workspaces', en: 'Workspaces' },
  'lib.todosWorkspaces': { pt: 'Todos os workspaces', en: 'All workspaces' },
  'lib.renomearWorkspace': { pt: 'Renomear workspace', en: 'Rename workspace' },
  'lib.buscar': { pt: 'Buscar', en: 'Search' },
  'lib.filtros': { pt: 'Filtros', en: 'Filters' },
  'lib.limparFiltros': { pt: 'Limpar filtros', en: 'Clear filters' },
  'lib.ordenar': { pt: 'Ordenar', en: 'Sort' },
  'lib.ordem.newest': { pt: 'Novas', en: 'New' },
  'lib.ordem.oldest': { pt: 'Antigas', en: 'Oldest' },
  'lib.ordem.plays': { pt: 'Mais tocadas', en: 'Most played' },
  'lib.ordem.likes': { pt: 'Mais curtidas', en: 'Most liked' },
  'lib.ordem.title': { pt: 'Título', en: 'Title' },
  'lib.ordem.duration': { pt: 'Duração', en: 'Duration' },
  'lib.modo.lista': { pt: 'Lista', en: 'List' },
  'lib.modo.onda': { pt: 'Onda', en: 'Waveform' },
  'lib.modo.grade': { pt: 'Grade', en: 'Grid' },
  'lib.uploads': { pt: 'Uploads', en: 'Uploads' },
  'lib.tipo': { pt: 'Tipo', en: 'Type' },
  'lib.tipo.all': { pt: 'Todas', en: 'All' },
  'lib.tipo.song': { pt: 'Músicas', en: 'Songs' },
  'lib.tipo.clip': { pt: 'Sons', en: 'Sounds' },
  'lib.tipo.upload': { pt: 'Uploads', en: 'Uploads' },
  'lib.tipo.derived': { pt: 'Derivadas', en: 'Derived' },
  'lib.voz': { pt: 'Voz', en: 'Vocals' },
  'lib.voz.all': { pt: 'Todas', en: 'All' },
  'lib.voz.vocal': { pt: 'Com voz', en: 'With vocals' },
  'lib.voz.instrumental': { pt: 'Instrumental', en: 'Instrumental' },
  'lib.status': { pt: 'Status', en: 'Status' },
  'lib.status.all': { pt: 'Todos', en: 'All' },
  'lib.status.ready': { pt: 'Prontas', en: 'Ready' },
  'lib.status.generating': { pt: 'Gerando', en: 'Generating' },
  'lib.status.failed': { pt: 'Falhas', en: 'Failed' },
  'lib.hoje': { pt: 'Hoje', en: 'Today' },
  'lib.ontem': { pt: 'Ontem', en: 'Yesterday' },
  'lib.pagina': { pt: 'Página', en: 'Page' },
  'lib.anterior': { pt: 'Anterior', en: 'Previous' },
  'lib.proxima': { pt: 'Próxima', en: 'Next' },
  'lib.nenhuma': { pt: 'Nenhuma música com esses filtros.', en: 'No songs match these filters.' },
  'lib.compartilhar': { pt: 'Compartilhar', en: 'Share' },
  'lib.linkCopiado': { pt: 'Link copiado', en: 'Link copied' },
  'lib.maisAcoes': { pt: 'Mais ações', en: 'More actions' },
  'lib.abrir': { pt: 'Abrir', en: 'Open' },
  'lib.baixarMp3': { pt: 'Baixar MP3', en: 'Download MP3' },
  'lib.usarReferencia': { pt: 'Usar como referência', en: 'Use as reference' },
  'lib.renomear': { pt: 'Renomear', en: 'Rename' },
  'lib.ondaCalculando': { pt: 'Calculando a forma de onda…', en: 'Computing the waveform…' },
  'lib.tocando': { pt: 'Tocando agora', en: 'Now playing' },
  'lib.kind.upload': { pt: 'upload', en: 'upload' },
  'lib.kind.remix': { pt: 'remix', en: 'remix' },
  'lib.kind.extend': { pt: 'estendida', en: 'extended' },
  'lib.kind.edit': { pt: 'edição', en: 'edit' },
  'lib.kind.clip': { pt: 'som', en: 'sound' },
  'lib.kind.cover': { pt: 'cover', en: 'cover' },
  'lib.kind.replace_section': { pt: 'trecho', en: 'section' },
  'lib.kind.remaster': { pt: 'remaster', en: 'remaster' },

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
    pt: 'Desenha outra capa no lugar da atual. Sem descrição, ela sai do estilo da música.',
    en: 'Draws a new cover to replace the current one. With no description, it comes from the song style.',
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
  'visual.titulo': { pt: 'Modo de visualização', en: 'View mode' },
  'visual.lista': { pt: 'Lista', en: 'List' },
  'visual.pequena': { pt: 'Miniatura pequena', en: 'Small thumbnails' },
  'visual.media': { pt: 'Miniatura média', en: 'Medium thumbnails' },
  'visual.detalhes': { pt: 'Detalhes', en: 'Details' },
  'visual.conteudo': { pt: 'Conteúdo', en: 'Content' },
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

  // Página da música (referência visual do Suno)
  'musica.editar': { pt: 'Editar', en: 'Edit' },
  'musica.edicaoTitulo': { pt: 'Editar a música', en: 'Edit the song' },
  'musica.editarLetra': { pt: 'Editar letra exibida', en: 'Edit displayed lyrics' },
  'musica.semLetra': { pt: 'Sem letra exibida.', en: 'No displayed lyrics.' },
  'musica.editarTitulo': { pt: 'Clique para editar o título', en: 'Click to edit the title' },
  'musica.editarEstilo': { pt: 'Clique para editar o estilo', en: 'Click to edit the style' },
  'musica.copiarEstilo': { pt: 'Copiar o estilo', en: 'Copy the style' },
  'musica.copiado': { pt: 'Copiado', en: 'Copied' },
  'musica.semEstilo': { pt: 'Adicionar um estilo', en: 'Add a style' },
  'musica.similares': { pt: 'Similares', en: 'Similar' },
  'musica.de': { pt: 'De', en: 'By' },
  'musica.nadaSimilar': { pt: 'Nenhuma música parecida ainda.', en: 'No similar songs yet.' },
  'musica.nadaDoAutor': {
    pt: 'Nenhuma outra música pública deste autor.',
    en: 'No other public songs by this author.',
  },
  'musica.remixBloqueado': {
    pt: 'Entre na sua conta, ou o autor não liberou remixes desta música.',
    en: 'Sign in, or the author has not allowed remixes of this song.',
  },
  'musica.pausar': { pt: 'Pausar', en: 'Pause' },
  'musica.detalhes': { pt: 'Ver a música', en: 'Open the song' },
  'musica.abrirComentarios': { pt: 'Ir para os comentários', en: 'Go to the comments' },
  'musica.baixarTitulo': { pt: 'Baixar a música', en: 'Download the song' },

  // Player do rodapé
  'player.embaralhar': { pt: 'Embaralhar', en: 'Shuffle' },
  'player.repetir': { pt: 'Repetir', en: 'Repeat' },
  'player.repetirTudo': { pt: 'Repetindo tudo', en: 'Repeating all' },
  'player.repetirUma': { pt: 'Repetindo esta', en: 'Repeating this one' },
  'player.anterior': { pt: 'Anterior', en: 'Previous' },
  'player.proxima': { pt: 'Próxima', en: 'Next' },
  'player.fila': { pt: 'Fila', en: 'Queue' },
  'player.volume': { pt: 'Volume', en: 'Volume' },
  'player.silenciar': { pt: 'Silenciar', en: 'Mute' },
  'player.ativarSom': { pt: 'Ativar o som', en: 'Unmute' },
  'player.posicao': { pt: 'Posição na faixa', en: 'Track position' },

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
  // Página de vendas. Sem travessão em nenhuma linha: é o tell nº 1 de texto
  // escrito por IA no Brasil, e o produto inteiro perde credibilidade junto.
  'planos.titulo': {
    pt: 'Comece de graça. Assine quando a música virar trabalho.',
    en: 'Start free. Subscribe when the music becomes work.',
  },
  'planos.sub': {
    pt: 'Cada música custa 10 créditos. No plano gratuito você ganha 30 por mês, sem cartão de crédito.',
    en: 'Each song costs 10 credits. The free plan gives you 30 a month, no credit card.',
  },
  'planos.gratis': { pt: 'Grátis', en: 'Free' },
  'planos.sugerido': { pt: 'Mais escolhido', en: 'Most popular' },
  'planos.musica': { pt: 'música', en: 'song' },
  'planos.musicas': { pt: 'músicas', en: 'songs' },
  'planos.porMes': { pt: 'por mês', en: 'per month' },
  'planos.porDia': { pt: 'por dia', en: 'per day' },
  'planos.saiPor': { pt: 'Sai por', en: 'That is' },
  'planos.porMusica': { pt: 'a música', en: 'per song' },
  'planos.soMp3': { pt: 'MP3 128 kbps', en: 'MP3 128 kbps' },
  'planos.formatos': { pt: 'formatos, na qualidade cheia', en: 'formats, full quality' },
  'planos.baixarLote': { pt: 'Baixar em lote', en: 'Batch download' },
  'planos.usoComercial': { pt: 'Uso comercial', en: 'Commercial use' },
  'planos.simultanea': { pt: 'música por vez', en: 'song at a time' },
  'planos.simultaneas': { pt: 'músicas ao mesmo tempo', en: 'songs at the same time' },
  'planos.comparar': { pt: 'Lado a lado', en: 'Side by side' },
  'planos.linhaMusicas': { pt: 'Músicas por ciclo', en: 'Songs per cycle' },
  'planos.linhaDuracao': { pt: 'Minutos por música', en: 'Minutes per song' },
  'planos.linhaFormatos': { pt: 'Formatos para baixar', en: 'Download formats' },
  'planos.linhaSimultaneas': { pt: 'Gerações ao mesmo tempo', en: 'Concurrent generations' },
  'planos.semCatalogo': {
    pt: 'Não consegui carregar os planos agora. Recarregue a página.',
    en: 'Could not load the plans right now. Reload the page.',
  },
  'planos.comecarGratis': { pt: 'Começar de graça', en: 'Start free' },
  'planos.irCriar': { pt: 'Ir para o estúdio', en: 'Go to the studio' },
  'planos.fechoTitulo': {
    pt: 'Dá para testar antes de decidir.',
    en: 'You can try before deciding.',
  },
  'planos.fechoTexto': {
    pt: 'Crie a conta, gere sua primeira música e veja se o resultado serve. Se não servir, você não gastou nada.',
    en: 'Create an account, generate your first song and see if it works for you. If it does not, you spent nothing.',
  },
  'planos.duvidas': { pt: 'Perguntas', en: 'Questions' },
  'planos.p1': { pt: 'O que é um crédito?', en: 'What is a credit?' },
  'planos.r1': {
    pt: 'A unidade que a plataforma gasta para gerar. Uma música completa custa 10 créditos e um efeito curto custa 5. O plano mostra quantas músicas dá, para você não precisar fazer conta.',
    en: 'The unit the platform spends to generate. A full song costs 10 credits and a short sound effect costs 5. The plan shows how many songs that is, so you do not have to do the math.',
  },
  'planos.p2': { pt: 'Posso usar as músicas comercialmente?', en: 'Can I use the songs commercially?' },
  'planos.r2': {
    pt: 'Nos planos pagos, sim. No gratuito não, porque ele existe para você testar a ferramenta e não para produzir material de cliente.',
    en: 'On paid plans, yes. Not on the free one, which exists for you to try the tool and not to produce client work.',
  },
  'planos.p3': { pt: 'E se eu cancelar?', en: 'What if I cancel?' },
  'planos.r3': {
    pt: 'Você cancela pela própria interface, sem abrir chamado. O acesso continua até o fim do período que já foi pago. Nos primeiros 7 dias você tem direito a desistir e receber de volta, que é o que o Código de Defesa do Consumidor garante em compra pela internet.',
    en: 'You cancel from the interface, no support ticket. Access lasts until the end of the period you already paid for. In the first 7 days you can withdraw and get a refund, which Brazilian consumer law guarantees for online purchases.',
  },
  'planos.p4': { pt: 'Os créditos acumulam?', en: 'Do credits roll over?' },
  'planos.r4': {
    pt: 'Os do plano não acumulam, eles renovam a cada ciclo. Os pacotes avulsos que você compra separado valem 12 meses e só são gastos depois que os do plano acabam.',
    en: 'Plan credits do not roll over, they renew each cycle. Credit packs you buy separately last 12 months and are only spent after the plan credits run out.',
  },
  'planos.p5': { pt: 'Dá para baixar tudo de uma vez?', en: 'Can I download everything at once?' },
  'planos.r5': {
    pt: 'Dá, em qualquer plano, inclusive no gratuito. Você marca as músicas na biblioteca e baixa um ZIP com todas. É o recurso que mais economiza tempo de quem produz em volume.',
    en: 'Yes, on any plan, including the free one. You select the songs in your library and download a ZIP with all of them. It is the feature that saves the most time for anyone producing in volume.',
  },
  'planos.p6': { pt: 'Preciso saber de música?', en: 'Do I need to know music?' },
  'planos.r6': {
    pt: 'Não. Você escreve o que quer ouvir em português mesmo, tipo "forró pé de serra com sanfona", e recebe a faixa. Se souber, o modo avançado deixa você mexer em andamento, tom, voz e letra.',
    en: 'No. You write what you want to hear in plain language, like "upbeat folk with accordion", and get the track. If you do know music, advanced mode lets you set tempo, key, vocals and lyrics.',
  },

  // Checkout de assinatura
  'assinar.plano': { pt: 'Plano escolhido', en: 'Chosen plan' },
  'assinar.passoConta': { pt: 'Sua conta', en: 'Your account' },
  'assinar.passoPagamento': { pt: 'Pagamento', en: 'Payment' },
  'assinar.continuar': { pt: 'Continuar para o pagamento', en: 'Continue to payment' },
  'assinar.metodo': { pt: 'Como quer pagar', en: 'How you want to pay' },
  'assinar.cartao': { pt: 'Cartão', en: 'Card' },
  'assinar.cpf': { pt: 'CPF ou CNPJ', en: 'Tax ID (CPF/CNPJ)' },
  'assinar.cpfDica': {
    pt: 'Exigido pelo processador de pagamento para emitir a cobrança.',
    en: 'Required by the payment processor to issue the charge.',
  },
  'assinar.pagar': { pt: 'Assinar', en: 'Subscribe' },
  'assinar.confirmado': { pt: 'Assinatura confirmada.', en: 'Subscription confirmed.' },
  'assinar.comecar': { pt: 'Começar a criar', en: 'Start creating' },
  'assinar.verOutros': { pt: 'Ver todos os planos', en: 'See all plans' },
  'assinar.cancelarQuando': {
    pt: 'Você pode cancelar quando quiser. O acesso vale até o fim do período pago.',
    en: 'Cancel whenever you want. Access lasts until the end of the paid period.',
  },

  // Formulário de pagamento (assinatura e pacote)
  'checkout.nome': { pt: 'Nome completo', en: 'Full name' },
  'checkout.redirecionando': {
    pt: 'Você vai para a página segura de pagamento. O cartão é digitado lá, nunca aqui.',
    en: 'You will go to the secure payment page. Card details are entered there, never here.',
  },
  'checkout.pixTitulo': { pt: 'Pague com o Pix', en: 'Pay with Pix' },
  'checkout.pixInstrucao': {
    pt: 'Escaneie o QR code ou copie o código. Os créditos entram assim que o pagamento for confirmado.',
    en: 'Scan the QR code or copy the code. Credits arrive as soon as the payment is confirmed.',
  },
  'checkout.copiar': { pt: 'Copiar código Pix', en: 'Copy Pix code' },
  'checkout.copiado': { pt: 'Copiado', en: 'Copied' },
  'checkout.aguardando': { pt: 'Aguardando o pagamento…', en: 'Waiting for payment…' },
  'checkout.confirmado': { pt: 'Pagamento confirmado.', en: 'Payment confirmed.' },
  'checkout.fechar': { pt: 'Voltar', en: 'Back' },
  'checkout.comprarPacote': { pt: 'Comprar pacote', en: 'Buy pack' },

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
  'comentarios.vazio': { pt: 'Nenhum comentário ainda!', en: 'No comments yet!' },
  'comentarios.placeholder': { pt: 'Escreva um comentário', en: 'Write a comment' },
  'comentarios.enviar': { pt: 'Comentar', en: 'Post' },
  'comentarios.marcarInstante': { pt: 'Marcar o instante', en: 'Mark the timestamp' },
  'comentarios.reagir': { pt: 'Reagir com', en: 'React with' },
  'comentarios.maisReacoes': { pt: 'Mais reações', en: 'More reactions' },
  'comentarios.dicaEnvio': {
    pt: 'Enter envia. Shift+Enter quebra a linha.',
    en: 'Enter sends. Shift+Enter adds a line.',
  },
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
