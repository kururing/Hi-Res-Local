import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const outDir = path.join(root, 'packages', 'audio-wasm', 'pkg');
mkdirSync(outDir, { recursive: true });

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run('cargo', [
  'build',
  '-p',
  'nnpm-audio-core',
  '--target',
  'wasm32-unknown-unknown',
  '--release',
  '--features',
  'wasm',
]);

function findWasm() {
  const dirs = [
    process.env.CARGO_TARGET_DIR,
    path.join(root, 'src-tauri', 'target'),
    path.join(root, 'target'),
  ].filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, 'wasm32-unknown-unknown', 'release', 'nnpm_audio_core.wasm');
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('nnpm_audio_core.wasm was not produced');
}

run('wasm-bindgen', [
  findWasm(),
  '--out-dir',
  outDir,
  '--target',
  'web',
  '--out-name',
  'nnpm_audio_core',
]);
