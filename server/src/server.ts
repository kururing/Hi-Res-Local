import { buildApp, productionLoggerOptions } from './app.js';
import { loadConfig } from './config/env.js';
import { migrate } from './db/migrator.js';
import { createPool } from './db/pool.js';

const config = loadConfig();
const pool = createPool(config.databaseUrl);
let applied: string[] = [];
try {
  applied = await migrate(pool);
} catch (error) {
  console.error(error);
  await pool.end().catch(() => undefined);
  process.exit(1);
}
const app = await buildApp({
  config,
  pool,
  logger: productionLoggerOptions(config),
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting_down');
  try {
    await app.close();
  } finally {
    await pool.end();
  }
  process.exit(0);
};

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info({
    host: config.host,
    port: config.port,
    docs: `http://${config.host}:${config.port}/docs`,
    applied_migrations: applied,
  }, 'server_started');
} catch (error) {
  app.log.error({ err: error }, 'server_failed_to_start');
  await pool.end();
  process.exit(1);
}
