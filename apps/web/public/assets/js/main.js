/* ============================================================
   Sonora — comportamento do site institucional.
   Zero dependência. Tudo aqui é progressivo: com o JS desligado
   a página continua completa e navegável.
   ============================================================ */
(function () {
  'use strict';

  // Marca que o JS rodou. É esta classe que autoriza o CSS a esconder
  // os blocos que serão revelados — sem ela, quem está sem JS (e os
  // rastreadores de busca) veria uma página em branco.
  document.documentElement.classList.add('js');

  var menosMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ----------------------------- ano do rodapé ----------------------------- */
  var ano = document.getElementById('ano');
  if (ano) ano.textContent = new Date().getFullYear();

  /* -------------------------------- menu ---------------------------------- */
  var botao = document.querySelector('.hamburguer');
  var menu = document.getElementById('menu');

  if (botao && menu) {
    botao.addEventListener('click', function () {
      var aberto = botao.getAttribute('aria-expanded') === 'true';
      botao.setAttribute('aria-expanded', String(!aberto));
      botao.setAttribute('aria-label', aberto ? 'Abrir menu' : 'Fechar menu');
      menu.classList.toggle('aberto', !aberto);
    });

    // Fecha ao navegar para uma seção.
    menu.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        menu.classList.remove('aberto');
        botao.setAttribute('aria-expanded', 'false');
        botao.setAttribute('aria-label', 'Abrir menu');
      }
    });

    // Esc fecha: quem abriu pelo teclado precisa conseguir sair pelo teclado.
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu.classList.contains('aberto')) {
        menu.classList.remove('aberto');
        botao.setAttribute('aria-expanded', 'false');
        botao.focus();
      }
    });
  }

  /* --------------------- borda do cabeçalho ao rolar ---------------------- */
  var cabecalho = document.querySelector('.cabecalho');
  if (cabecalho) {
    var aoRolar = function () {
      cabecalho.classList.toggle('rolou', window.scrollY > 8);
    };
    aoRolar();
    window.addEventListener('scroll', aoRolar, { passive: true });
  }

  /* ------------------------------ scrollspy ------------------------------- */
  var secoes = Array.prototype.slice.call(
    document.querySelectorAll('main section[id]')
  );
  var links = Array.prototype.slice.call(document.querySelectorAll('.nav a[href^="#"]'));

  if (secoes.length && links.length && 'IntersectionObserver' in window) {
    var espia = new IntersectionObserver(
      function (entradas) {
        entradas.forEach(function (entrada) {
          if (!entrada.isIntersecting) return;
          var id = entrada.target.id;
          links.forEach(function (a) {
            a.classList.toggle('ativo', a.getAttribute('href') === '#' + id);
          });
        });
      },
      // A faixa estreita no meio da tela evita que duas seções fiquem
      // marcadas como ativas ao mesmo tempo.
      { rootMargin: '-45% 0px -50% 0px' }
    );
    secoes.forEach(function (s) { espia.observe(s); });
  }

  /* -------------------------- revelação ao entrar ------------------------- */
  var reveláveis = document.querySelectorAll(
    '.secao__cabeca, .passo, .cartao, .plano, .fato, .tabela-envolve, .faq__item, .cta__conteudo'
  );

  if (menosMovimento || !('IntersectionObserver' in window)) {
    // Sem animação: mostra tudo de uma vez, sem transição.
    Array.prototype.forEach.call(reveláveis, function (el) {
      el.classList.add('revela', 'visivel');
    });
  } else {
    var observador = new IntersectionObserver(
      function (entradas) {
        entradas.forEach(function (entrada) {
          if (!entrada.isIntersecting) return;
          entrada.target.classList.add('visivel');
          observador.unobserve(entrada.target);
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    );

    Array.prototype.forEach.call(reveláveis, function (el, i) {
      el.classList.add('revela');
      // Escalonamento curto entre irmãos, para a seção não "pipocar" inteira.
      el.style.transitionDelay = (i % 4) * 60 + 'ms';
      observador.observe(el);
    });

    // Rede de segurança: conteúdo NUNCA pode ficar invisível.
    //
    // A revelação por scroll depende do observer disparar. Se ele não disparar
    // — captura de tela da página inteira, impressão, leitor que não rola, uma
    // aba aberta em segundo plano — o visitante fica com uma página em branco
    // abaixo do primeiro bloco. Já aconteceu aqui, na primeira revisão visual.
    //
    // Duas redes: o que já está perto da tela aparece de imediato, e depois de
    // 2,5 s tudo aparece de qualquer jeito. O efeito continua para quem rola
    // normalmente; o que some é o modo de falha.
    var revelarTudo = function () {
      Array.prototype.forEach.call(reveláveis, function (el) {
        el.style.transitionDelay = '0ms';
        el.classList.add('visivel');
      });
    };

    var revelarProximos = function () {
      var limite = window.innerHeight * 1.5;
      Array.prototype.forEach.call(reveláveis, function (el) {
        if (el.getBoundingClientRect().top < limite) el.classList.add('visivel');
      });
    };

    revelarProximos();
    window.setTimeout(revelarTudo, 2500);
    window.addEventListener('beforeprint', revelarTudo);
  }

  /* --------------------------- copiar prompt (blog) ------------------------ */
  // Os blocos de prompt do blog existem para ir direto para a aba Criar. O
  // botão nasce escondido no HTML e só aparece aqui, onde a área de
  // transferência existe: sem JS ou sem permissão, o texto continua
  // selecionável à mão e não sobra um botão que não faz nada.
  if (navigator.clipboard) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-copiar]'), function (btn) {
      var alvo = document.getElementById(btn.getAttribute('data-copiar'));
      if (!alvo) return;
      btn.hidden = false;
      btn.addEventListener('click', function () {
        navigator.clipboard.writeText(alvo.textContent.trim()).then(function () {
          btn.textContent = 'Copiado';
          window.setTimeout(function () { btn.textContent = 'Copiar'; }, 1800);
        }, function () {
          btn.textContent = 'Selecione e copie';
        });
      });
    });
  }

  /* -------------------------------- LGPD --------------------------------- */
  var aviso = document.getElementById('lgpd');
  var ok = document.getElementById('lgpd-ok');
  var CHAVE = 'sonora_cookies_ok';

  if (aviso && ok) {
    var jaAceitou = false;
    try {
      jaAceitou = localStorage.getItem(CHAVE) === '1';
    } catch (e) {
      // Navegação privada ou storage bloqueado: mostra o aviso e segue.
      jaAceitou = false;
    }

    if (!jaAceitou) {
      aviso.hidden = false;
      ok.addEventListener('click', function () {
        aviso.hidden = true;
        try { localStorage.setItem(CHAVE, '1'); } catch (e) { /* sem storage, só some nesta visita */ }
      });
    }
  }
})();
