import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function envFlag(name: string): boolean {
  const raw = process.env[name];
  return raw === 'true' || raw === '1';
}

export function integrationTestsRequired(): boolean {
  return envFlag('INTEGRATION_TESTS_REQUIRED') || envFlag('REQUIRE_INTEGRATION');
}

export function s3IntegrationRequired(): boolean {
  return envFlag('S3_INTEGRATION_REQUIRED');
}

export function nnpmProbeRequired(): boolean {
  return envFlag('NNPM_PROBE_REQUIRED');
}

export type GateStatus = 'PASS' | 'SKIP' | 'FAIL';

export interface IntegrationReport {
  postgres: GateStatus;
  s3: GateStatus;
  nnpmProbe: GateStatus;
  ranSuites: string[];
}

export const REQUIRED_PG_SUITES = [
  'auth integration',
  'catalog integration',
  'library integration',
  'playlists integration',
  'favorites integration',
  'history integration',
  'lyrics integration',
  'streaming integration',
  'admin RBAC',
  'admin uploads',
  'admin publication',
  'admin imports',
  'ingestion worker',
  'frontend contract',
  'openapi',
] as const;

const EMPTY_REPORT: IntegrationReport = {
  postgres: 'SKIP',
  s3: 'SKIP',
  nnpmProbe: 'SKIP',
  ranSuites: [],
};

export function integrationSummaryPath(): string {
  return process.env.INTEGRATION_SUMMARY_PATH
    ?? path.resolve(process.cwd(), 'integration-summary.txt');
}

export function integrationReportPath(): string {
  return process.env.INTEGRATION_REPORT_PATH
    ?? path.resolve(process.cwd(), 'integration-report.json');
}

function isGateStatus(value: unknown): value is GateStatus {
  return value === 'PASS' || value === 'SKIP' || value === 'FAIL';
}

export function readIntegrationReport(): IntegrationReport {
  try {
    const raw = JSON.parse(readFileSync(integrationReportPath(), 'utf8')) as Partial<IntegrationReport>;
    if (!raw || typeof raw !== 'object') return { ...EMPTY_REPORT, ranSuites: [] };
    return {
      postgres: isGateStatus(raw.postgres) ? raw.postgres : 'SKIP',
      s3: isGateStatus(raw.s3) ? raw.s3 : 'SKIP',
      nnpmProbe: isGateStatus(raw.nnpmProbe) ? raw.nnpmProbe : 'SKIP',
      ranSuites: Array.isArray(raw.ranSuites)
        ? raw.ranSuites.filter((name): name is string => typeof name === 'string')
        : [],
    };
  } catch {
    return { ...EMPTY_REPORT, ranSuites: [] };
  }
}

export function persistIntegrationReport(report: IntegrationReport): void {
  const file = integrationReportPath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(report)}\n`, 'utf8');
}

export function resetIntegrationReport(): void {
  persistIntegrationReport({ ...EMPTY_REPORT, ranSuites: [] });
}

function mutateReport(mutator: (report: IntegrationReport) => void): IntegrationReport {
  const report = readIntegrationReport();
  mutator(report);
  persistIntegrationReport(report);
  integrationReport.postgres = report.postgres;
  integrationReport.s3 = report.s3;
  integrationReport.nnpmProbe = report.nnpmProbe;
  integrationReport.ranSuites = [...report.ranSuites];
  return report;
}

export const integrationReport: IntegrationReport = readIntegrationReport();

export function markSuiteRan(name: string): void {
  mutateReport((report) => {
    if (!report.ranSuites.includes(name)) {
      report.ranSuites.push(name);
    }
  });
}

export function setGate(name: keyof Pick<IntegrationReport, 'postgres' | 's3' | 'nnpmProbe'>, status: GateStatus): void {
  mutateReport((report) => {
    const current = report[name];
    if (status === 'FAIL' || current === 'SKIP' || (current === 'PASS' && status === 'PASS')) {
      if (current !== 'FAIL') report[name] = status;
    }
  });
}

export function formatIntegrationSummary(report: IntegrationReport = readIntegrationReport()): string[] {
  const ranRequired = REQUIRED_PG_SUITES.filter((name) => report.ranSuites.includes(name)).length;
  const postgres = report.postgres === 'PASS'
    ? `PostgreSQL integration: PASS (${ranRequired} suites)`
    : `PostgreSQL integration: ${report.postgres}`;
  return [
    postgres,
    `S3 integration: ${report.s3}`,
    `nnpm-probe integration: ${report.nnpmProbe}`,
  ];
}

export function requiredGateFailures(report: IntegrationReport = readIntegrationReport()): string[] {
  const failures: string[] = [];
  if (integrationTestsRequired()) {
    if (report.postgres !== 'PASS') {
      failures.push(`PostgreSQL integration: ${report.postgres}`);
    }
    for (const name of REQUIRED_PG_SUITES) {
      if (!report.ranSuites.includes(name)) {
        failures.push(`missing suite ${name}`);
      }
    }
  }
  if (s3IntegrationRequired() && report.s3 !== 'PASS') {
    failures.push(`S3 integration: ${report.s3}`);
  }
  if (nnpmProbeRequired() && report.nnpmProbe !== 'PASS') {
    failures.push(`nnpm-probe integration: ${report.nnpmProbe}`);
  }
  return failures;
}

export function printIntegrationSummary(report: IntegrationReport = readIntegrationReport()): string[] {
  const lines = formatIntegrationSummary(report);
  for (const line of lines) {
    console.log(line);
  }
  const summary = `${lines.join('\n')}\n`;
  writeFileSync(integrationSummaryPath(), summary, 'utf8');
  return lines;
}

export function coverageFileWasCollected(paths: Iterable<string> | undefined): boolean {
  if (!paths) return existsSync(integrationReportPath());
  for (const file of paths) {
    if (file.replaceAll('\\', '/').includes('zzz-coverage')) return true;
  }
  return false;
}
