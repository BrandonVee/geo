import { describe, expect, it } from "vitest";
import {
  createDatabasePoolConfig,
  createRuntimeDatabasePoolConfig,
} from "./pool-config";

describe("database pool configuration", () => {
  it("uses bounded production defaults", () => {
    expect(
      createDatabasePoolConfig({
        DATABASE_URL: "postgresql://app:secret@database:5432/geo",
      }),
    ).toMatchObject({
      application_name: "answerbit-geo",
      max: 10,
      idleTimeoutMillis: 30_000,
      maxLifetimeSeconds: 300,
      connectionTimeoutMillis: 5_000,
      query_timeout: 30_000,
      keepAlive: true,
    });
  });

  it("parses explicit pool limits from environment strings", () => {
    expect(
      createDatabasePoolConfig({
        DATABASE_URL: "postgresql://app:secret@database:5432/geo",
        DB_APPLICATION_NAME: "answerbit-geo-worker",
        DB_POOL_MAX: "24",
        DB_POOL_IDLE_TIMEOUT_MS: "45000",
        DB_POOL_MAX_LIFETIME_SECONDS: "600",
        DB_CONNECT_TIMEOUT_MS: "8000",
        DB_QUERY_TIMEOUT_MS: "90000",
      }),
    ).toMatchObject({
      application_name: "answerbit-geo-worker",
      max: 24,
      idleTimeoutMillis: 45_000,
      maxLifetimeSeconds: 600,
      connectionTimeoutMillis: 8_000,
      query_timeout: 90_000,
    });
  });

  it("keeps module initialization inert when readiness configuration is invalid", () => {
    expect(
      createRuntimeDatabasePoolConfig({
        DATABASE_URL: "https://not-postgresql.example.com",
      }),
    ).toMatchObject({
      connectionString:
        "postgresql://configuration:invalid@127.0.0.1:1/configuration_invalid",
      max: 1,
      connectionTimeoutMillis: 100,
    });
  });
});
