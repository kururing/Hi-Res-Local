import type { AppConfig } from '../config/env.js';
import { originFromUrl } from '../storage/publicUrl.js';

export function apiContentSecurityPolicy(config: AppConfig): string {
  const artwork = originFromUrl(config.publicMediaBaseUrl);
  const media = originFromUrl(config.s3.publicEndpoint);
  const extras = [artwork, media].filter((value, index, list): value is string => {
    return Boolean(value) && list.indexOf(value) === index;
  });
  const connect = ["'self'", ...extras].join(' ');
  const img = ["'self'", 'data:', 'blob:', ...extras].join(' ');
  const mediaSrc = ["'self'", 'blob:', ...extras].join(' ');
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `connect-src ${connect}`,
    `img-src ${img}`,
    `media-src ${mediaSrc}`,
    "script-src 'none'",
    "style-src 'none'",
    "object-src 'none'",
  ].join('; ');
}

export function applySecurityHeaders(
  headers: { header(name: string, value: string): unknown },
  config: AppConfig,
): void {
  headers.header('X-Content-Type-Options', 'nosniff');
  headers.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.header('X-Frame-Options', 'DENY');
  headers.header('Content-Security-Policy', apiContentSecurityPolicy(config));
  headers.header(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  );
}

export function cspAllowsWildcard(policy: string): boolean {
  return /(?:^|;)\s*(?:default-src|script-src|connect-src|img-src|media-src)\s+[^;]*\*/.test(policy);
}
