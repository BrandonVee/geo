import {
  answerbitBrandMappings,
  balanceAccounts,
  organizationMembers,
  organizations,
  withPlatformDbContext,
} from "@geo/db";
import type { AdminOrganizationPageQuery } from "@geo/contracts";
import { and, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";

// @project-doc docs/architecture/platform_administration.md#enterprise_directory
export async function listPlatformOrganizations(
  input: AdminOrganizationPageQuery,
  userId: string,
  includeBalances = false,
) {
  const pattern = input.q
    ? `%${input.q.replace(/[\\%_]/g, "\\$&")}%`
    : undefined;
  const where = and(
    input.status
      ? eq(organizations.status, input.status as "active" | "suspended")
      : undefined,
    ne(organizations.status, "closed"),
    input.accessState === "suspended"
      ? eq(organizations.status, "suspended")
      : input.accessState === "active"
        ? and(
            eq(organizations.status, "active"),
            sql`(${organizations.serviceExpiresAt} is null or ${organizations.serviceExpiresAt} > now())`,
          )
        : input.accessState === "expired"
          ? and(
              eq(organizations.status, "active"),
              sql`${organizations.serviceExpiresAt} <= now()`,
            )
          : undefined,
    pattern
      ? or(
          ilike(organizations.name, pattern),
          ilike(organizations.slug, pattern),
          ilike(sql`${organizations.id}::text`, pattern),
          ilike(answerbitBrandMappings.brandId, pattern),
          ilike(answerbitBrandMappings.brandName, pattern),
        )
      : undefined,
  );
  return withPlatformDbContext(
    { userId },
    async (tx) => {
      const [count] = await tx
        .select({
          value: sql<number>`count(distinct ${organizations.id})::int`,
        })
        .from(organizations)
        .innerJoin(
          answerbitBrandMappings,
          eq(answerbitBrandMappings.organizationId, organizations.id),
        )
        .where(where);
      const total = count?.value ?? 0;
      const pages = Math.ceil(total / input.pageSize);
      const page = Math.min(input.page, Math.max(pages, 1));
      const list = await tx
        .select({
          id: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
          serviceExpiresAt: organizations.serviceExpiresAt,
          pointsExpiresAt: organizations.pointsExpiresAt,
          status: organizations.status,
          accessState: sql<
            "active" | "suspended" | "expired"
          >`case when ${organizations.status} = 'suspended' then 'suspended' when ${organizations.serviceExpiresAt} <= now() then 'expired' else 'active' end`,
          pointsExpired: sql<boolean>`coalesce(${organizations.pointsExpiresAt} <= now(), false)`,
          planCode: organizations.planCode,
          createdAt: organizations.createdAt,
          memberCount: sql<number>`count(distinct ${organizationMembers.id})::int`,
          answerbitBrandId: sql<
            string | null
          >`max(${answerbitBrandMappings.brandId})`,
          answerbitBrandName: sql<
            string | null
          >`max(${answerbitBrandMappings.brandName})`,
        })
        .from(organizations)
        .innerJoin(
          answerbitBrandMappings,
          eq(answerbitBrandMappings.organizationId, organizations.id),
        )
        .leftJoin(
          organizationMembers,
          eq(organizationMembers.organizationId, organizations.id),
        )
        .where(where)
        .groupBy(organizations.id)
        .orderBy(desc(organizations.createdAt), desc(organizations.id))
        .limit(input.pageSize)
        .offset((page - 1) * input.pageSize);
      const accounts =
        includeBalances && list.length
          ? await tx
              .select()
              .from(balanceAccounts)
              .where(
                inArray(
                  balanceAccounts.organizationId,
                  list.map((row) => row.id),
                ),
              )
          : [];
      return {
        list: includeBalances
          ? list.map((row) => ({
              ...row,
              balances: {
                enterprisePoints:
                  accounts.find(
                    (a) =>
                      a.organizationId === row.id &&
                      a.brandId === null &&
                      a.asset === "answerbit_points",
                  )?.balance ?? 0,
                enterprisePublicationCny:
                  accounts.find(
                    (a) =>
                      a.organizationId === row.id &&
                      a.brandId === null &&
                      a.asset === "publication_cny",
                  )?.balance ?? 0,
                brandPoints:
                  accounts.find(
                    (a) =>
                      a.organizationId === row.id &&
                      a.brandId === row.answerbitBrandId &&
                      a.asset === "answerbit_points",
                  )?.balance ?? 0,
                brandPublicationCny:
                  accounts.find(
                    (a) =>
                      a.organizationId === row.id &&
                      a.brandId === row.answerbitBrandId &&
                      a.asset === "publication_cny",
                  )?.balance ?? 0,
              },
            }))
          : list,
        pagination: { page, pageSize: input.pageSize, total, pages },
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
