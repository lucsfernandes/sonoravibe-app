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
};

export default config;
