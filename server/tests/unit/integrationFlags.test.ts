import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  envFlag,
  formatIntegrationSummary,
  integrationTestsRequired,
  markSuiteRan,
  readIntegrationReport,
  resetIntegrationReport,
  s3IntegrationRequired,
  setGate,
  nnpmProbeRequired,
  REQUIRED_PG_SUITES,
} from '../integration/flags.js';

const keys = ['INTEGRATION_TESTS_REQUIRED', 'S3_INTEGRATION_REQUIRED', 'NNPM_PROBE_REQUIRED', 'REQUIRE_INTEGRATION'];

describe('required integration flags', () => {
  const previous: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });

  it('treats missing infra as a failure only when the matching flag is required', () => {
    for (const key of keys) previous[key] = process.env[key];
    delete process.env.INTEGRATION_TESTS_REQUIRED;
    delete process.env.REQUIRE_INTEGRATION;
    delete process.env.S3_INTEGRATION_REQUIRED;
    delete process.env.NNPM_PROBE_REQUIRED;
    expect(integrationTestsRequired()).toBe(false);
    expect(s3IntegrationRequired()).toBe(false);
    expect(nnpmProbeRequired()).toBe(false);

    process.env.INTEGRATION_TESTS_REQUIRED = 'true';
    process.env.S3_INTEGRATION_REQUIRED = 'true';
    process.env.NNPM_PROBE_REQUIRED = 'true';
    expect(integrationTestsRequired()).toBe(true);
    expect(s3IntegrationRequired()).toBe(true);
    expect(nnpmProbeRequired()).toBe(true);
    expect(envFlag('S3_INTEGRATION_REQUIRED')).toBe(true);
  });

  it('prints the machine-readable coverage lines with the required suite count', () => {
    expect(REQUIRED_PG_SUITES).toHaveLength(15);
    expect(formatIntegrationSummary({
      postgres: 'PASS',
      s3: 'PASS',
      nnpmProbe: 'PASS',
      ranSuites: [...REQUIRED_PG_SUITES],
    })).toEqual([
      'PostgreSQL integration: PASS (15 suites)',
      'S3 integration: PASS',
      'nnpm-probe integration: PASS',
    ]);
  });

  it('persists suite and gate state so a later reader sees the same report', () => {
    const previous = process.env.INTEGRATION_REPORT_PATH;
    process.env.INTEGRATION_REPORT_PATH = path.join(
      mkdtempSync(path.join(tmpdir(), 'nnpm-flags-')),
      'integration-report.json',
    );
    try {
      resetIntegrationReport();
      setGate('postgres', 'PASS');
      markSuiteRan('auth integration');
      const report = readIntegrationReport();
      expect(report.postgres).toBe('PASS');
      expect(report.ranSuites).toContain('auth integration');
    } finally {
      if (previous === undefined) delete process.env.INTEGRATION_REPORT_PATH;
      else process.env.INTEGRATION_REPORT_PATH = previous;
    }
  });
});
