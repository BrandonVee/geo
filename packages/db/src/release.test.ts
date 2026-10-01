import { readFile, readdir } from "node:fs/promises";
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

  it("keeps migration snapshots ordered with a single ancestry chain", async () => {
    const root = new URL("../drizzle/meta/", import.meta.url);
    const names = (await readdir(root))
      .filter((name) => name.endsWith("_snapshot.json"))
      .sort();
    let previous = "00000000-0000-0000-0000-000000000000";
    for (const name of names) {
      expect(name).toMatch(/^\d{4}_snapshot\.json$/);
      const snapshot = JSON.parse(await readFile(new URL(name, root), "utf8"));
      expect(snapshot.prevId).toBe(previous);
      previous = snapshot.id;
    }
    const journal = JSON.parse(
      await readFile(new URL("_journal.json", root), "utf8"),
    );
    expect(names.at(-1)).toBe(
      `${String(journal.entries.at(-1).idx).padStart(4, "0")}_snapshot.json`,
    );
  });

  it("keeps the readiness revision aligned with the latest migration", async () => {
    const journal = JSON.parse(
      await readFile(
        new URL("../drizzle/meta/_journal.json", import.meta.url),
        "utf8",
      ),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries).toHaveLength(
      Number(CURRENT_SCHEMA_VERSION.slice(1)),
    );
    expect(journal.entries[0]?.idx).toBe(0);
    expect(journal.entries[0]?.tag).toBe("v1");
    expect(journal.entries.at(-1)?.tag).toBe(CURRENT_SCHEMA_VERSION);

    const migration = await readFile(
      new URL(`../drizzle/${CURRENT_SCHEMA_VERSION}.sql`, import.meta.url),
      "utf8",
    );
    expect(migration).toContain(`('schema', '${CURRENT_SCHEMA_VERSION}')`);
    expect(migration).toContain("creation_key");
    expect(migration).toContain("creation_fingerprint");
    expect(migration).toContain("deleted_at");
    expect(migration).toContain("saved_views_org_creation_key_ux");
    const publicationActionMigration = await readFile(
      new URL("../drizzle/v12.sql", import.meta.url),
      "utf8",
    );
    expect(publicationActionMigration).toContain("provider_action");
    const actorMigration = await readFile(
      new URL("../drizzle/v11.sql", import.meta.url),
      "utf8",
    );
    expect(actorMigration).toContain("tenant_balance_actors");
    expect(actorMigration).toContain("SECURITY DEFINER");
    expect(actorMigration).toContain("FROM PUBLIC");
    const trackingMigration = await readFile(
      new URL("../drizzle/v10.sql", import.meta.url),
      "utf8",
    );
    expect(trackingMigration).toContain("article_tracking_submissions");
    expect(trackingMigration).toContain(
      "article_tracking_submissions_org_key_ux",
    );
    expect(trackingMigration).toContain("ENABLE ROW LEVEL SECURITY");
    const documentCreationMigration = await readFile(
      new URL("../drizzle/v9.sql", import.meta.url),
      "utf8",
    );
    expect(documentCreationMigration).toContain("creation_key");
    expect(documentCreationMigration).toContain("creation_fingerprint");
    expect(documentCreationMigration).toContain(
      "content_documents_org_creation_key_ux",
    );
    const validityMigration = await readFile(
      new URL("../drizzle/v8.sql", import.meta.url),
      "utf8",
    );
    expect(validityMigration).toContain("service_expires_at");
    expect(validityMigration).toContain("points_expires_at");

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
