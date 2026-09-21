import { databaseEnv } from "@geo/config";
import type { PoolConfig } from "pg";

const localDatabaseUrl = "postgresql://geo:geo@localhost:5432/geo";

export function createDatabasePoolConfig(
  source: NodeJS.ProcessEnv = process.env,
): PoolConfig {
  const configuration = databaseEnv({
    ...source,
    DATABASE_URL: source.DATABASE_URL ?? localDatabaseUrl,
  });
  return {
    connectionString: configuration.DATABASE_URL,
    application_name: configuration.DB_APPLICATION_NAME,
    max: configuration.DB_POOL_MAX,
    idleTimeoutMillis: configuration.DB_POOL_IDLE_TIMEOUT_MS,
    maxLifetimeSeconds: configuration.DB_POOL_MAX_LIFETIME_SECONDS,
    connectionTimeoutMillis: configuration.DB_CONNECT_TIMEOUT_MS,
    query_timeout: configuration.DB_QUERY_TIMEOUT_MS,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  };
}

export function createRuntimeDatabasePoolConfig(
  source: NodeJS.ProcessEnv = process.env,
): PoolConfig {
  try {
    return createDatabasePoolConfig(source);
  } catch {
    return {
      connectionString:
        "postgresql://configuration:invalid@127.0.0.1:1/configuration_invalid",
      application_name: "answerbit-geo-invalid-config",
      max: 1,
      idleTimeoutMillis: 1_000,
      maxLifetimeSeconds: 30,
      connectionTimeoutMillis: 100,
      query_timeout: 1_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    };
  }
}
