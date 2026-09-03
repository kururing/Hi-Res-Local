import { spawn } from 'node:child_process';
import { ProbeError, parseNnpmProbeJson, type AudioProbe, type ProbedAudioMetadata } from './probe.js';

export class NnpmProbeAudioProbe implements AudioProbe {
  constructor(
    private readonly probePath: string,
    private readonly timeoutMs = 20_000,
    private readonly maxOutputBytes = 1_048_576,
  ) {}

  inspect(filePath: string): Promise<ProbedAudioMetadata> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.probePath, ['--json', filePath], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout: Buffer = Buffer.alloc(0);
      let stderr: Buffer = Buffer.alloc(0);
      let settled = false;

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(new ProbeError('PROBE_TIMEOUT', 'Media probe timed out.', true));
      }, this.timeoutMs);

      const append = (current: Buffer, chunk: Buffer): Buffer => {
        const next = Buffer.concat([current, chunk]);
        if (next.length > this.maxOutputBytes) {
          child.kill('SIGKILL');
          throw new ProbeError('PROBE_OUTPUT_LIMIT', 'Media probe output exceeded the size limit.');
        }
        return next;
      };

      child.stdout.on('data', (chunk: Buffer) => {
        try {
          stdout = append(stdout, chunk);
        } catch (error) {
          finish(error);
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        try {
          stderr = append(stderr, chunk);
        } catch (error) {
          finish(error);
        }
      });
      child.on('error', (error) => {
        finish(new ProbeError('PROBE_SPAWN_FAILED', sanitizeProbeText(error.message), true));
      });
      child.on('close', (code) => {
        if (code !== 0) {
          finish(new ProbeError(
            'PROBE_FAILED',
            `Media probe rejected the file.${sanitizeProbeText(stderr.toString('utf8')) ? ` ${sanitizeProbeText(stderr.toString('utf8'))}` : ''}`,
          ));
          return;
        }
        try {
          finish(parseNnpmProbeJson(stdout.toString('utf8')));
        } catch (error) {
          finish(error);
        }
      });

      function finish(result: ProbedAudioMetadata | unknown): void {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (result instanceof Error) reject(result);
        else resolve(result as ProbedAudioMetadata);
      }
    });
  }
}

export const NNPM_PROBE_MISSING = 'NNPM_PROBE_MISSING';

export function sanitizeProbeText(value: string, max = 240): string {
  return value
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function isNnpmProbeVersionOutput(text: string): boolean {
  return /\bnnpm-probe\b/i.test(text);
}

export async function assertNnpmProbeAvailable(
  nnpmProbePath: string,
  timeoutMs = 5_000,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(nnpmProbePath, ['--version'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new ProbeError(NNPM_PROBE_MISSING, 'nnpm-probe --version timed out.'));
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      finish(new ProbeError(
        NNPM_PROBE_MISSING,
        `nnpm-probe executable was not available (${sanitizeProbeText(error.message)}).`,
      ));
    });
    child.on('close', (code) => {
      const combined = `${stdout}\n${stderr}`;
      if (code === 0 && isNnpmProbeVersionOutput(combined)) {
        finish();
        return;
      }
      if (code === 0) {
        finish(new ProbeError(
          NNPM_PROBE_MISSING,
          'NNPM_PROBE_PATH must point to the nnpm-probe executable.',
        ));
        return;
      }
      finish(new ProbeError(
        NNPM_PROBE_MISSING,
        `nnpm-probe --version exited ${code}${sanitizeProbeText(stderr || stdout) ? `: ${sanitizeProbeText(stderr || stdout)}` : '.'}`,
      ));
    });

    function finish(error?: ProbeError): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    }
  });
}

export async function nnpmProbeAvailable(nnpmProbePath: string, timeoutMs = 3_000): Promise<boolean> {
  try {
    await assertNnpmProbeAvailable(nnpmProbePath, timeoutMs);
    return true;
  } catch {
    return false;
  }
}

