import { printIntegrationSummary, readIntegrationReport } from './integration/flags.js';
import { closeIntegration } from './integration/helpers.js';

export default async function globalTeardown(): Promise<void> {
  printIntegrationSummary(readIntegrationReport());
  await closeIntegration();
}
