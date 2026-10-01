import { sql } from "drizzle-orm";
import { db, pool } from "./client";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export type DatabaseTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

// @project-doc docs/architecture/data_and_security.md#tenant_isolation
export function withTenantDbContext<T>(
  context: {
    organizationId: string;
    userId: string;
    teamBindingId?: string;
    brandId?: string;
  },
  run: (tx: DatabaseTransaction) => Promise<T>,
  options?: Parameters<typeof db.transaction>[1],
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw("set local role geo_tenant_app"));
    await tx.execute(
      sql`select set_config('app.organization_id', ${context.organizationId}, true), set_config('app.user_id', ${context.userId}, true), set_config('app.team_binding_id', ${context.teamBindingId ?? ""}, true), set_config('app.brand_id', ${context.brandId ?? ""}, true)`,
    );
    return run(tx);
  }, options);
}

export function withPlatformDbContext<T>(
  context: { userId: string },
  run: (tx: DatabaseTransaction) => Promise<T>,
  options?: Parameters<typeof db.transaction>[1],
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw("set local role geo_platform_app"));
    await tx.execute(
      sql`select set_config('app.organization_id', '', true), set_config('app.user_id', ${context.userId}, true), set_config('app.team_binding_id', '', true), set_config('app.brand_id', '', true)`,
    );
    return run(tx);
  }, options);
}

export type SqlExecutor = {
  executeSql(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
};

// @project-doc docs/architecture/backend_layers.md#async_transactions
export async function withDatabaseTransaction<T>(
  run: (tx: DatabaseTransaction, sqlExecutor: SqlExecutor) => Promise<T>,
) {
  const connection = await pool.connect();
  try {
    return await drizzle(connection, { schema }).transaction((tx) =>
      run(tx, { executeSql: (text, values) => connection.query(text, values) }),
    );
  } finally {
    connection.release();
  }
}
