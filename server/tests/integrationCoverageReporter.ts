import {
  coverageFileWasCollected,
  printIntegrationSummary,
  readIntegrationReport,
  requiredGateFailures,
} from './integration/flags.js';

export default class IntegrationCoverageReporter {
  private coverageFileInRun = false;

  onPathsCollected(paths: string[] = []): void {
    if (coverageFileWasCollected(paths)) this.coverageFileInRun = true;
  }

  onCollected(files: Array<{ filepath?: string }> = []): void {
    if (coverageFileWasCollected(files.map((file) => file.filepath ?? ''))) {
      this.coverageFileInRun = true;
    }
  }

  onFinished(): void {
    const report = readIntegrationReport();
    printIntegrationSummary(report);
    if (!this.coverageFileInRun) return;
    const failures = requiredGateFailures(report);
    if (failures.length > 0) {
      const message = `Integration coverage gate failed:\n${failures.join('\n')}`;
      console.error(message);
      process.exitCode = 1;
      throw new Error(message);
    }
  }
}
