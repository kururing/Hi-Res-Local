import { loadConfig } from '../config/env.js';
import { parseFlagArgs } from './args.js';
import { grantRole } from './grantRole.js';
import { createPool } from '../db/pool.js';

const args = parseFlagArgs(process.argv.slice(2));
const email = typeof args.email === 'string' ? args.email : '';
const role = typeof args.role === 'string' ? args.role : '';

if (!email || !role) {
  console.error('Usage: node dist/cli/grantRoleMain.js --email user@example.test --role catalog_admin');
  process.exit(1);
}

const config = loadConfig();
const pool = createPool(config.databaseUrl);
try {
  const result = await grantRole(pool, email, role);
  console.log(result.granted
    ? `Granted ${role} to ${result.email}.`
    : `${result.email} already has ${role}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await pool.end();
}
