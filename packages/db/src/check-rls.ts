import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  db,
  evaluateDatabaseReleaseState,
  organizations,
  pool,
  withPlatformDbContext,
  withTenantDbContext,
} from "./index";
let [first] = await db
  .select({ id: organizations.id })
  .from(organizations)
  .orderBy(organizations.id)
  .limit(1);
const temporaryIds: string[] = [];
if (!first) {
  const marker = randomUUID();
  [first] = await db
    .insert(organizations)
    .values({ name: "RLS 隔离检查企业 A", slug: `rls-check-a-${marker}` })
    .returning({ id: organizations.id });
  temporaryIds.push(first.id);
}
const marker = randomUUID();
const [second] = await db
  .insert(organizations)
  .values({ name: "RLS 隔离检查企业 B", slug: `rls-check-b-${marker}` })
  .returning({ id: organizations.id });
temporaryIds.push(second.id);
try {
  const tenantRows = await withTenantDbContext(
    { organizationId: first.id, userId: randomUUID() },
    (tx) =>
      tx.execute<{ id: string }>(sql`select id from organizations order by id`),
  );
  if (tenantRows.rows.length !== 1 || tenantRows.rows[0]?.id !== first.id)
    throw new Error("TENANT_RLS_READ_ISOLATION_FAILED");
  const crossTenant = await withTenantDbContext(
    { organizationId: first.id, userId: randomUUID() },
    (tx) =>
      tx.execute<{ id: string }>(
        sql`select id from organizations where id = ${second.id}`,
      ),
  );
  if (crossTenant.rows.length)
    throw new Error("TENANT_RLS_CROSS_TENANT_READ_ALLOWED");
  const crossWrite = await withTenantDbContext(
    { organizationId: first.id, userId: randomUUID() },
    (tx) =>
      tx.execute<{ id: string }>(
        sql`update organizations set name = name where id = ${second.id} returning id`,
      ),
  );
  if (crossWrite.rows.length)
    throw new Error("TENANT_RLS_CROSS_TENANT_WRITE_ALLOWED");
  const platformRows = await withPlatformDbContext(
    { userId: randomUUID() },
    (tx) => tx.execute<{ id: string }>(sql`select id from organizations`),
  );
  if (
    !platformRows.rows.some((row) => row.id === first.id) ||
    !platformRows.rows.some((row) => row.id === second.id)
  )
    throw new Error("PLATFORM_RLS_ACCESS_FAILED");
  let tenantRuntimeAccessDenied = false;
  try {
    await withTenantDbContext(
      { organizationId: first.id, userId: randomUUID() },
      (tx) => tx.execute(sql`select id from runtime_heartbeats limit 1`),
    );
  } catch (error) {
    const databaseError = error as
      | { code?: string; cause?: { code?: string } }
      | undefined;
    tenantRuntimeAccessDenied =
      databaseError?.code === "42501" || databaseError?.cause?.code === "42501";
  }
  if (!tenantRuntimeAccessDenied)
    throw new Error("TENANT_RUNTIME_HEARTBEAT_ACCESS_ALLOWED");
  let tenantRuntimeTaskAccessDenied = false;
  try {
    await withTenantDbContext(
      { organizationId: first.id, userId: randomUUID() },
      (tx) =>
        tx.execute(sql`select task_name from runtime_task_statuses limit 1`),
    );
  } catch (error) {
    const databaseError = error as
      | { code?: string; cause?: { code?: string } }
      | undefined;
    tenantRuntimeTaskAccessDenied =
      databaseError?.code === "42501" || databaseError?.cause?.code === "42501";
  }
  if (!tenantRuntimeTaskAccessDenied)
    throw new Error("TENANT_RUNTIME_TASK_ACCESS_ALLOWED");
  let tenantReleaseStateAccessDenied = false;
  try {
    await withTenantDbContext(
      { organizationId: first.id, userId: randomUUID() },
      (tx) => tx.execute(sql`select component from system_release_state`),
    );
  } catch (error) {
    const databaseError = error as
      | { code?: string; cause?: { code?: string } }
      | undefined;
    tenantReleaseStateAccessDenied =
      databaseError?.code === "42501" || databaseError?.cause?.code === "42501";
  }
  if (!tenantReleaseStateAccessDenied)
    throw new Error("TENANT_RELEASE_STATE_ACCESS_ALLOWED");
  let tenantFrogCredentialAccessDenied = false;
  try {
    await withTenantDbContext(
      { organizationId: first.id, userId: randomUUID() },
      (tx) => tx.execute(sql`select id from platform_frog_credentials limit 1`),
    );
  } catch (error) {
    const databaseError = error as
      | { code?: string; cause?: { code?: string } }
      | undefined;
    tenantFrogCredentialAccessDenied =
      databaseError?.code === "42501" || databaseError?.cause?.code === "42501";
  }
  if (!tenantFrogCredentialAccessDenied)
    throw new Error("TENANT_FROG_CREDENTIAL_ACCESS_ALLOWED");
  const platformRuntimeRows = await withPlatformDbContext(
    { userId: randomUUID() },
    (tx) => tx.execute(sql`select id from runtime_heartbeats limit 1`),
  );
  const platformRuntimeTaskRows = await withPlatformDbContext(
    { userId: randomUUID() },
    (tx) =>
      tx.execute(sql`select task_name from runtime_task_statuses limit 1`),
  );
  const platformReleaseStateRows = await withPlatformDbContext(
    { userId: randomUUID() },
    (tx) =>
      tx.execute<{ component: string; version: string }>(
        sql`select component, version from system_release_state where component in ('schema', 'seed')`,
      ),
  );
  const platformFrogCredentialRows = await withPlatformDbContext(
    { userId: randomUUID() },
    (tx) =>
      tx.execute<{ id: number }>(
        sql`select id from platform_frog_credentials limit 1`,
      ),
  );
  const releaseReadiness = evaluateDatabaseReleaseState(
    platformReleaseStateRows.rows,
  );
  if (!releaseReadiness.schemaReady || !releaseReadiness.seedReady)
    throw new Error("DATABASE_RELEASE_STATE_NOT_READY");
  console.info(
    JSON.stringify({
      tenantVisible: tenantRows.rows.length,
      crossTenantVisible: crossTenant.rows.length,
      crossTenantWrites: crossWrite.rows.length,
      platformVisible: platformRows.rows.length,
      tenantRuntimeAccessDenied,
      tenantRuntimeTaskAccessDenied,
      tenantReleaseStateAccessDenied,
      tenantFrogCredentialAccessDenied,
      platformRuntimeVisible: platformRuntimeRows.rows.length,
      platformRuntimeTaskVisible: platformRuntimeTaskRows.rows.length,
      platformReleaseStateVisible: platformReleaseStateRows.rows.length,
      platformFrogCredentialVisible: platformFrogCredentialRows.rows.length,
      releaseReadiness,
    }),
  );
} finally {
  for (const id of temporaryIds.reverse())
    await db.delete(organizations).where(eq(organizations.id, id));
  await pool.end();
}
