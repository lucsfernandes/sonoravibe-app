import { join } from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Imagem de produção enxuta: o Next monta um servidor autocontido com só as
  // dependências que ele realmente importa, em vez de carregar o node_modules
  // inteiro do monorepo para dentro do contêiner.
  output: 'standalone',
  // Em monorepo o Next precisa saber onde fica a raiz para reunir os arquivos
  // do standalone; sem isto ele adivinha pelo lockfile mais próximo e deixa os
  // pacotes internos de fora.
  outputFileTracingRoot: join(import.meta.dirname, '../../'),
  // O pacote compartilhado é TypeScript cru no monorepo; o Next precisa
  // transpilá-lo junto em vez de esperar JavaScript já compilado.
  transpilePackages: ['@sonora/shared'],
  images: {
    // Capas e avatares vêm do R2 por URL assinada.
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
  /**
   * A raiz serve o site institucional, não o aplicativo.
   *
   * Quem chega em sonoravibe.com pela primeira vez precisa entender o que é o
   * produto antes de ver um campo de prompt. O aplicativo começa em `/inicio`,
   * e todo o resto (`/criar`, `/explorar`…) continua onde estava.
   *
   * `beforeFiles` é obrigatório aqui: os rewrites padrão (`afterFiles`) só
   * rodam depois de o roteador procurar uma página, e `app/inicio/page.tsx`
   * não existe em `/` — mas se um dia existir uma página em `/`, ela venceria
   * o rewrite em silêncio. Com `beforeFiles` a regra vale sempre.
   *
   * O destino é um arquivo de `public/`: HTML estático, sem React no caminho.
   * Os links de dentro dele são relativos (`assets/css/styles.css`,
   * `img/fones.jpg`), e é por isso que os arquivos ficam na raiz de `public/`
   * e não numa subpasta — de `/site/` eles apontariam para fora.
   */
  async rewrites() {
    return {
      beforeFiles: [{ source: '/', destination: '/index.html' }],
      afterFiles: [],
      fallback: [],
    };
  },
  /**
   * Cabeçalhos de segurança em toda resposta, inclusive nos arquivos de
   * `public/`. A CSP só leva o que não quebra nada (iframe, base, form,
   * plugin): restringir `script-src` exige nonce em cada <script> que o Next
   * injeta, e isso é trabalho à parte.
   */
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
          },
        ],
      },
    ];
  },
};

export default config;
