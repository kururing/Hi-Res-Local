import { afterAll, describe, expect, it } from 'vitest';
import {
  REQUIRED_PG_SUITES,
  nnpmProbeRequired,
  integrationTestsRequired,
  printIntegrationSummary,
  readIntegrationReport,
  s3IntegrationRequired,
} from './flags.js';

afterAll(() => {
  printIntegrationSummary(readIntegrationReport());
});

describe('integration coverage gate', () => {
  it('records that required PostgreSQL suites actually ran', () => {
    if (!integrationTestsRequired()) {
      return;
    }
    const report = readIntegrationReport();
    expect(report.postgres).toBe('PASS');
    for (const name of REQUIRED_PG_SUITES) {
      expect(report.ranSuites, `missing suite ${name}`).toContain(name);
    }
  });

  it('does not skip S3 or nnpm-probe when those flags are required', () => {
    const report = readIntegrationReport();
    if (s3IntegrationRequired()) {
      expect(report.s3).toBe('PASS');
    }
    if (nnpmProbeRequired()) {
      expect(report.nnpmProbe).toBe('PASS');
    }
  });
});
