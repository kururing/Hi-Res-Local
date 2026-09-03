import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cspAllowsWildcard } from '../../src/http/securityHeaders.js';

const nginxPath = path.resolve(fileURLToPath(new URL('../../../web/nginx.conf', import.meta.url)));

describe('web nginx cache and CSP', () => {
  it('keeps index.html short-lived and hashed assets immutable', () => {
    const conf = readFileSync(nginxPath, 'utf8');
    expect(conf).toMatch(/location = \/index\.html[\s\S]*Cache-Control "no-cache, must-revalidate"/);
    expect(conf).toMatch(/location \^~ \/assets\/[\s\S]*Cache-Control "public, max-age=31536000, immutable"/);
    expect(conf).toContain('X-Content-Type-Options');
    expect(conf).toContain('Referrer-Policy');
    expect(conf).toContain('Permissions-Policy');
    expect(conf).toContain('proxy_pass');
    expect(conf).toContain('proxy_set_header X-Forwarded-For $remote_addr');
    expect(conf).not.toContain('$proxy_add_x_forwarded_for');
    expect(conf).not.toContain('api.example.com');
    const csp = conf.match(/Content-Security-Policy\s+"([^"]+)"/)?.[1] ?? '';
    expect(csp).toContain("style-src-attr 'unsafe-inline'");
    expect(cspAllowsWildcard(csp.replace(/\$[A-Z_]+/g, 'http://127.0.0.1:9000'))).toBe(false);
  });
});
