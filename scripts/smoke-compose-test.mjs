import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const api = process.env.SMOKE_API_URL ?? 'http://127.0.0.1:8080/api';
const deadline = Date.now() + Number(process.env.SMOKE_TIMEOUT_MS ?? 180_000);

async function waitReady() {
  let last = 'not started';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${api}/health/ready`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Smoke stack was not ready: ${last}`);
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}`));
    });
  });
}

await waitReady();
await run('npm', ['run', 'server:smoke:e2e'], {
  ...process.env,
  SMOKE_API_URL: api,
  SMOKE_ORIGIN: process.env.SMOKE_ORIGIN ?? 'http://127.0.0.1:8080',
  SMOKE_WORKER: process.env.SMOKE_WORKER ?? 'docker',
  SMOKE_COMPOSE_FILE: process.env.SMOKE_COMPOSE_FILE ?? path.join(repoRoot, 'infra/compose.smoke.yml'),
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://nghenhac:nghenhac@127.0.0.1:5434/nghenhac',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9010',
  S3_PUBLIC_ENDPOINT: process.env.S3_PUBLIC_ENDPOINT ?? 'http://127.0.0.1:9010',
  JWT_SECRET: process.env.JWT_SECRET ?? 'smoke-jwt-secret-value-32-chars-min',
  CORS_ORIGINS: process.env.CORS_ORIGINS ?? 'http://127.0.0.1:8080',
  MEDIA_PROBE_MODE: 'nnpm',
});
