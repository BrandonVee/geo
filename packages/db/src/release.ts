import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { withPlatformDbContext } from "./context";
import { systemReleaseState } from "./schema";

export const CURRENT_SCHEMA_VERSION = "v4";
export const CURRENT_SEED_VERSION = "v2";

const requiredVersions = {
  schema: CURRENT_SCHEMA_VERSION,
  seed: CURRENT_SEED_VERSION,
} as const;
const releaseRevisionPattern = /^v([1-9]\d*)$/;

function parseReleaseRevision(value: string | undefined) {
  const match = value?.match(releaseRevisionPattern);
  return match ? Number(match[1]) : undefined;
}

function satisfiesRevision(actual: string | undefined, required: string) {
  const actualRevision = parseReleaseRevision(actual);
  const requiredRevision = parseReleaseRevision(required);
  return (
    actualRevision !== undefined &&
    requiredRevision !== undefined &&
    actualRevision >= requiredRevision
  );
}

export type DatabaseReleaseReadiness = {
  schemaReady: boolean;
  seedReady: boolean;
};

export function evaluateDatabaseReleaseState(
  rows: ReadonlyArray<{ component: string; version: string }>,
): DatabaseReleaseReadiness {
  const versions = new Map(rows.map((row) => [row.component, row.version]));
  return {
    schemaReady: satisfiesRevision(
      versions.get("schema"),
      requiredVersions.schema,
    ),
    seedReady: satisfiesRevision(versions.get("seed"), requiredVersions.seed),
  };
}

export async function inspectDatabaseReleaseState(): Promise<DatabaseReleaseReadiness> {
  const rows = await withPlatformDbContext({ userId: randomUUID() }, (tx) =>
    tx
      .select({
        component: systemReleaseState.component,
        version: systemReleaseState.version,
      })
      .from(systemReleaseState)
      .where(inArray(systemReleaseState.component, ["schema", "seed"])),
  );
  return evaluateDatabaseReleaseState(rows);
}
