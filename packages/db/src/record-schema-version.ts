import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pool } from "./client";
import { CURRENT_SCHEMA_VERSION } from "./release";

const v1MigrationTimestamp = 1_789_696_960_155;
const v1MigrationHash = createHash("sha256")
  .update(await readFile(new URL("../drizzle/v1.sql", import.meta.url)))
  .digest("hex");
const compatibleLegacyVersions = new Set([
  "0044_lively_shard",
  "0044_baseline",
]);

const client = await pool.connect();
try {
  await client.query("BEGIN");
  const result = await client.query<{ version: string }>(`
      SELECT version
      FROM public.system_release_state
      WHERE component = 'schema'
      FOR UPDATE
    `);
  const currentVersion = result.rows[0]?.version;
  const v1Structure = await client.query<{ complete: boolean }>(`
      SELECT
        to_regclass('public.system_release_state') IS NOT NULL
        AND to_regclass('public.runtime_task_statuses') IS NOT NULL
        AND to_regclass('public.platform_answerbit_brands') IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'publication_orders'
            AND column_name = 'provider_synced_at'
        ) AS complete
    `);

  if (!v1Structure.rows[0]?.complete)
    throw new Error("DATABASE_V1_STRUCTURE_INCOMPLETE");

  if (
    currentVersion === CURRENT_SCHEMA_VERSION &&
    !(
      await client.query<{ complete: boolean }>(`
      SELECT
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'service_expires_at')
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'points_expires_at')
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'content_documents' AND column_name = 'creation_key')
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'content_documents' AND column_name = 'creation_fingerprint')
        AND to_regclass('public.content_documents_org_creation_key_ux') IS NOT NULL
        AND to_regclass('public.article_tracking_submissions') IS NOT NULL
        AND to_regclass('public.article_tracking_submissions_org_key_ux') IS NOT NULL
        AND to_regclass('public.platform_frog_credentials') IS NOT NULL
        AND to_regclass('public.pricing_tier_rules') IS NOT NULL
        AND to_regclass('public.publication_channel_price_overrides') IS NOT NULL
        AND to_regclass('public.content_folders') IS NOT NULL
        AND to_regclass('public.content_documents') IS NOT NULL
        AND to_regclass('public.content_document_versions') IS NOT NULL
        AND to_regclass('public.answerbit_read_cache') IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'publication_channels'
            AND column_name = 'provider_cost_amount'
        )
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'users'
            AND column_name = 'pricing_tier'
        )
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'pricing_tier_rules'
            AND column_name = 'point_markup_bps'
        )
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'article_generation_jobs'
            AND column_name = 'pricing_snapshot'
        )
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'publication_orders'
            AND column_name = 'source_document_id'
        ) AS complete
    `)
    ).rows[0]?.complete
  )
    throw new Error("DATABASE_V10_STRUCTURE_INCOMPLETE");

  const currentVRevision = currentVersion?.match(/^v([1-9]\d*)$/);
  if (
    currentVersion !== CURRENT_SCHEMA_VERSION &&
    !compatibleLegacyVersions.has(currentVersion ?? "") &&
    !currentVRevision
  )
    throw new Error(`DATABASE_SCHEMA_VERSION_UNSUPPORTED:${currentVersion}`);

  // These functions belonged to tables removed before v1 and are not part of
  // the current schema. Existing 0044 databases may still retain them.
  await client.query(`
    DROP FUNCTION IF EXISTS public.enforce_billing_order_transition();
    DROP FUNCTION IF EXISTS public.protect_billing_refund();
  `);

  const currentRevision = currentVRevision
    ? Number(currentVRevision[1])
    : undefined;
  if (currentRevision === undefined || currentRevision === 1) {
    const ledger = await client.query<{ latest: string | null }>(`
      SELECT max(created_at)::text AS latest
      FROM drizzle.__drizzle_migrations
    `);
    const latestMigration = Number(ledger.rows[0]?.latest ?? 0);
    if (latestMigration > v1MigrationTimestamp)
      throw new Error("DATABASE_MIGRATION_LEDGER_AHEAD_OF_V1");

    await client.query(
      "TRUNCATE TABLE drizzle.__drizzle_migrations RESTART IDENTITY",
    );
    await client.query(
      `INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
       VALUES ($1, $2)`,
      [v1MigrationHash, v1MigrationTimestamp],
    );
  }

  if (currentRevision === undefined || currentRevision < 1) {
    await client.query(
      `
        INSERT INTO public.system_release_state (component, version)
        VALUES ('schema', $1)
        ON CONFLICT (component) DO UPDATE
        SET version = excluded.version, updated_at = now()
      `,
      [CURRENT_SCHEMA_VERSION],
    );
  }

  console.info("database-release.schema-version-recorded", {
    version:
      currentRevision !== undefined && currentRevision > 1
        ? currentVersion
        : CURRENT_SCHEMA_VERSION,
    ...(currentRevision !== undefined && currentRevision > 1
      ? {}
      : { migrationRecords: 1 }),
  });
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
