import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Os testes tocam o Postgres real e usam decorators do TypeORM, por isso o
// transformador é o swc (o esbuild do vitest não faz emitDecoratorMetadata).
export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    include: ['test/**/*.spec.ts'],
    // Um schema compartilhado por arquivo de teste: sem paralelismo entre eles.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
