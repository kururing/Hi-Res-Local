import { resetIntegrationReport } from './integration/flags.js';

export default function globalSetup(): void {
  resetIntegrationReport();
}
