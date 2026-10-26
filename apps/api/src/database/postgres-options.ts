// Keep pools small for a single API instance; connections are opened lazily.
export function postgresOptions(connectionString: string) {
  return {
    connectionString,
    max: 5,
    connectionTimeoutMillis: 3_000,
    idleTimeoutMillis: 10_000,
    statement_timeout: 3_000,
    query_timeout: 4_000,
  };
}
