import { loadConfig } from '../src/config/env.js';
import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrator.js';

const config = loadConfig();
const pool = createPool(config.databaseUrl);

try {
  const applied = await migrate(pool);
  console.log(applied.length === 0
    ? 'Migrations are already up to date.'
    : `Applied migrations: ${applied.join(', ')}`);
} finally {
  await pool.end();
}
