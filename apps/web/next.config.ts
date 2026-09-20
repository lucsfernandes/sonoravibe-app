import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // O pacote compartilhado é TypeScript cru no monorepo; o Next precisa
  // transpilá-lo junto em vez de esperar JavaScript já compilado.
  transpilePackages: ['@sonora/shared'],
  images: {
    // Capas e avatares vêm do R2 por URL assinada.
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
};

export default config;
