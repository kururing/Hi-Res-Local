import pg from 'pg';

const { Pool } = pg;

export function createPool(databaseUrl: string, connectionTimeoutMillis = 5_000): pg.Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis,
  });
}

export async function pingDatabase(pool: pg.Pool): Promise<void> {
  await pool.query('SELECT 1');
}
