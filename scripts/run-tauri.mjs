import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'src-tauri', 'target');
const tmp = path.join(root, '.tmp');

mkdirSync(target, { recursive: true });
mkdirSync(tmp, { recursive: true });

const env = {
  ...process.env,
  CARGO_TARGET_DIR: target,
  TMP: tmp,
  TEMP: tmp,
  TMPDIR: tmp,
};

const tauriCli = path.join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
const child = spawn(process.execPath, [tauriCli, ...process.argv.slice(2)], {
  cwd: root,
  env,
  stdio: 'inherit',
  shell: false,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
