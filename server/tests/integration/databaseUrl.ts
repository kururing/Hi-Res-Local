const DATABASE_URL_PATTERN = /^(postgres(?:ql)?:\/\/[^/]+)\/([^?]*)(.*)$/i;

export interface ParsedDatabaseUrl {
  origin: string;
  name: string;
  rest: string;
}

export function parseDatabaseUrl(databaseUrl: string): ParsedDatabaseUrl {
  const match = databaseUrl.match(DATABASE_URL_PATTERN);
  const name = match?.[2];
  if (!match || !name) {
    throw new Error('DATABASE_URL must include a database name.');
  }
  return { origin: match[1], name, rest: match[3] ?? '' };
}

export function replaceDatabaseName(databaseUrl: string, name: string): string {
  const parsed = parseDatabaseUrl(databaseUrl);
  return `${parsed.origin}/${name}${parsed.rest}`;
}

export function assertSafeDatabaseName(name: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Refusing to create database ${JSON.stringify(name)}; use a simple PostgreSQL identifier.`);
  }
  return name;
}

/** Derive a sibling `{name}_test` database so integration tests never share the app catalog. */
export function toIntegrationDatabaseUrl(databaseUrl: string): string {
  const { name } = parseDatabaseUrl(databaseUrl);
  if (name.endsWith('_test')) return databaseUrl;
  return replaceDatabaseName(databaseUrl, `${name}_test`);
}
