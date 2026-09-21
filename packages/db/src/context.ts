import { sql } from "drizzle-orm";
import { db } from "./client";

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
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw("set local role geo_tenant_app"));
    await tx.execute(
      sql`select set_config('app.organization_id', ${context.organizationId}, true), set_config('app.user_id', ${context.userId}, true), set_config('app.team_binding_id', ${context.teamBindingId ?? ""}, true), set_config('app.brand_id', ${context.brandId ?? ""}, true)`,
    );
    return run(tx);
  });
}

export function withPlatformDbContext<T>(
  context: { userId: string },
  run: (tx: DatabaseTransaction) => Promise<T>,
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw("set local role geo_platform_app"));
    await tx.execute(
      sql`select set_config('app.organization_id', '', true), set_config('app.user_id', ${context.userId}, true), set_config('app.team_binding_id', '', true), set_config('app.brand_id', '', true)`,
    );
    return run(tx);
  });
}
