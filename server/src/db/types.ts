import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

export type Queryable = Pool | PoolClient;

export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The original error is more useful than a rollback failure.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function query<T extends QueryResultRow>(
  db: Queryable,
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<T>> {
  return db.query<T>(text, values);
}

export function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  if (typeof value === 'bigint') return Number(value);
  return Number(value);
}

export function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
