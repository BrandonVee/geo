import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  CURRENT_SCHEMA_VERSION,
  CURRENT_SEED_VERSION,
  evaluateDatabaseReleaseState,
} from "./release";

describe("database release readiness", () => {
  it("requires current or newer vN schema and seed revisions", () => {
    expect(
      evaluateDatabaseReleaseState([
        { component: "schema", version: CURRENT_SCHEMA_VERSION },
        { component: "seed", version: CURRENT_SEED_VERSION },
      ]),
    ).toEqual({ schemaReady: true, seedReady: true });
    expect(
      evaluateDatabaseReleaseState([
        { component: "schema", version: "v0" },
        { component: "seed", version: CURRENT_SEED_VERSION },
      ]),
    ).toEqual({ schemaReady: false, seedReady: true });
    expect(evaluateDatabaseReleaseState([])).toEqual({
      schemaReady: false,
      seedReady: false,
    });
    expect(
      evaluateDatabaseReleaseState([
        { component: "schema", version: "v2" },
        { component: "seed", version: "v2" },
      ]),
    ).toEqual({ schemaReady: false, seedReady: true });
  });

  it("keeps the readiness revision aligned with the latest migration", async () => {
    const journal = JSON.parse(
      await readFile(
        new URL("../drizzle/meta/_journal.json", import.meta.url),
        "utf8",
      ),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries).toHaveLength(7);
    expect(journal.entries[0]?.idx).toBe(0);
    expect(journal.entries[0]?.tag).toBe("v1");
    expect(journal.entries.at(-1)?.tag).toBe(CURRENT_SCHEMA_VERSION);

    const migration = await readFile(
      new URL(`../drizzle/${CURRENT_SCHEMA_VERSION}.sql`, import.meta.url),
      "utf8",
    );
    expect(migration).toContain(`('schema', '${CURRENT_SCHEMA_VERSION}')`);
    expect(migration).toContain("pricing_snapshot");

    const pointMarkupMigration = await readFile(
      new URL("../drizzle/v6.sql", import.meta.url),
      "utf8",
    );
    expect(pointMarkupMigration).toContain(
      "RENAME COLUMN point_multiplier_bps TO point_markup_bps",
    );

    const readCacheMigration = await readFile(
      new URL("../drizzle/v5.sql", import.meta.url),
      "utf8",
    );
    expect(readCacheMigration).toContain(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON public.answerbit_read_cache TO geo_tenant_app, geo_platform_app",
    );

    const baseline = await readFile(
      new URL("../drizzle/v1.sql", import.meta.url),
      "utf8",
    );
    expect(baseline.match(/CREATE TABLE public\./g)).toHaveLength(44);
    expect(baseline.match(/CREATE TYPE public\./g)).toHaveLength(26);
    expect(baseline.match(/CREATE FUNCTION public\./g)).toHaveLength(8);
    expect(baseline).not.toContain("enforce_billing_order_transition");
    expect(baseline).not.toContain("protect_billing_refund");
    expect(baseline.trimEnd()).toMatch(
      /set_config\('search_path', 'public, pg_catalog', false\);$/,
    );
  });
});
