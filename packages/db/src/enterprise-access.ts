import { eq } from "drizzle-orm";
import { validateEnterpriseAccess } from "@geo/core";
import { db } from "./client";
import { organizations } from "./schema";
export async function assertEnterpriseAccess(
  organizationId: string,
  requirePoints = false,
  executor: Pick<typeof db, "select"> = db,
) {
  const [organization] = await executor
    .select({
      status: organizations.status,
      serviceExpiresAt: organizations.serviceExpiresAt,
      pointsExpiresAt: organizations.pointsExpiresAt,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .for("share")
    .limit(1);
  validateEnterpriseAccess(organization, requirePoints);
}
