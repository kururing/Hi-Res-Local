import { defineConfig } from 'vite';
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
export default defineConfig({
  plugins: [react(), kuromojiDictionaryPlugin()],
  resolve: {
    alias: {
      '@': sourceDirectory,
      path: fileURLToPath(new URL('./src/shims/path-browserify.ts', import.meta.url)),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_'],
});
