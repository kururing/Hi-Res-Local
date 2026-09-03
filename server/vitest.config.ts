import { defineConfig } from 'vitest/config';
import CoverageLastSequencer from './tests/coverageSequencer';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@nnpm/api-client': fileURLToPath(new URL('../packages/api-client/src/index.ts', import.meta.url)),
      '@nnpm/audio-contracts': fileURLToPath(new URL('../packages/audio-contracts/src/index.ts', import.meta.url)),
      '@nnpm/audio-wasm': fileURLToPath(new URL('../packages/audio-wasm/src/index.ts', import.meta.url)),
      '@nnpm/shared-types': fileURLToPath(new URL('../packages/shared-types/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: ['default', './tests/integrationCoverageReporter.ts'],
    isolate: false,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    teardownTimeout: 10_000,
    globalSetup: './tests/globalSetup.ts',
    globalTeardown: './tests/globalTeardown.ts',
    sequence: {
      concurrent: false,
      sequencer: CoverageLastSequencer,
    },
  },
});
