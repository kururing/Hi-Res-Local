import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';

const sourceDirectory = fileURLToPath(new URL('./src', import.meta.url));
const kuromojiDictionaryDirectory = fileURLToPath(
  new URL('./node_modules/kuromoji/dict/', import.meta.url)
);
const kuromojiDictionaryFiles = readdirSync(kuromojiDictionaryDirectory)
  .filter(file => file.endsWith('.dat.gz'));

const kuromojiDictionaryPlugin = () => ({
  name: 'local-kuromoji-dictionary',
  configureServer(server: { middlewares: { use: (path: string, handler: (request: { url?: string }, response: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body?: Buffer) => void }, next: () => void) => void) => void } }) {
    server.middlewares.use('/kuromoji-dict', (request, response, next) => {
      const filename = request.url?.split('?')[0].replace(/^\//, '');
      if (!filename || !kuromojiDictionaryFiles.includes(filename)) {
        next();
        return;
      }
      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/octet-stream');
      response.end(readFileSync(`${kuromojiDictionaryDirectory}/${filename}`));
    });
  },
  generateBundle(this: { emitFile: (asset: { type: 'asset'; fileName: string; source: Buffer }) => void }) {
    for (const filename of kuromojiDictionaryFiles) {
      this.emitFile({
        type: 'asset',
        fileName: `kuromoji-dict/${filename}`,
        source: readFileSync(`${kuromojiDictionaryDirectory}/${filename}`),
      });
    }
  },
});

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.VITE_CLOUD_API_PROXY_TARGET?.trim() || 'http://127.0.0.1:3001';

  return {
    plugins: [react(), kuromojiDictionaryPlugin()],
    resolve: {
      alias: {
        '@': sourceDirectory,
        '@nnpm/api-client': fileURLToPath(new URL('../packages/api-client/src/index.ts', import.meta.url)),
        '@nnpm/audio-contracts': fileURLToPath(new URL('../packages/audio-contracts/src/index.ts', import.meta.url)),
        '@nnpm/audio-wasm': fileURLToPath(new URL('../packages/audio-wasm/src/index.ts', import.meta.url)),
        '@nnpm/shared-types': fileURLToPath(new URL('../packages/shared-types/src/index.ts', import.meta.url)),
        path: fileURLToPath(new URL('./src/shims/path-browserify.ts', import.meta.url)),
      },
    },
    server: {
      port: 1420,
      strictPort: true,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api/, ''),
          // Refresh cookie Path=/v1/auth on the backend; browsers store the
          // cookie against the Vite origin, so the path must match /api/v1/auth.
          cookiePathRewrite: {
            '/v1/auth': '/api/v1/auth',
          },
        },
      },
    },
    assetsInclude: ['**/*.wasm'],
    clearScreen: false,
    envPrefix: ['VITE_', 'TAURI_'],
    build: {
      // The only chunk above Vite's 500 kB default is the lazily loaded
      // any-ascii transliteration table; the startup bundles remain below 310 kB.
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('lucide-react')) return 'icons';
            if (id.includes('react') || id.includes('scheduler')) return 'react-vendor';
            if (id.includes('@tauri-apps')) return 'tauri-vendor';
            if (id.includes('kuroshiro') || id.includes('kuromoji')) return 'japanese-romanizer';
            if (id.includes('pinyin-pro')) return 'chinese-romanizer';
            if (id.includes('hangul-romanization')) return 'korean-romanizer';
            if (id.includes('wanakana')) return 'kana-tools';
            if (id.includes('any-ascii')) return 'universal-romanizer';
            return 'vendor';
          },
        },
      },
    },
    test: {
      setupFiles: ['./src/tests/support/reactAct.ts'],
      projects: [
        {
          test: {
            name: 'node',
            environment: 'node',
            include: ['src/tests/**/*.test.ts'],
          },
        },
        {
          test: {
            name: 'jsdom',
            environment: 'jsdom',
            include: ['src/tests/**/*.test.tsx'],
            setupFiles: ['./src/tests/support/reactAct.ts'],
          },
        },
      ],
    },
  };
});
