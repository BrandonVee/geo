import {
  billableFeatures,
  permissions as permissionCodes,
  rolePermissions as permissionMatrix,
  roles as roleCodes,
  type Role,
} from "@geo/core";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  billingPlans,
  billingPlanVersions,
  db,
  featurePointCosts,
  organizations,
  permissions,
  platformSubscriptions,
  pricingTierRules,
  quotaLedgers,
  rolePermissions,
  roles,
  pool,
  publicationChannels,
  subscriptionEntitlements,
  systemReleaseState,
  type PlanEntitlements,
} from "./index";
import { CURRENT_SEED_VERSION } from "./release";

const roleNames: Record<Role, string> = {
  super_admin: "平台管理员",
  tenant_admin: "企业管理员",
  brand_admin: "品牌管理员",
  brand_editor: "品牌编辑者",
  brand_viewer: "普通用户",
};
await db.transaction(async (tx) => {
  await tx
    .insert(permissions)
    .values(permissionCodes.map((code) => ({ code })))
    .onConflictDoNothing();
  await tx
    .insert(roles)
    .values(
      roleCodes.map((code) => ({
        code,
        name: roleNames[code],
        scope:
          code === "super_admin"
            ? ("platform" as const)
            : ("organization" as const),
      })),
    )
    .onConflictDoNothing();
  const storedRoles = await tx.select().from(roles);
  const storedPermissions = await tx.select().from(permissions);
  for (const role of storedRoles) {
    const allowed = permissionMatrix[role.code as Role];
    if (!allowed) continue;
    for (const permission of storedPermissions.filter((item) =>
      allowed.has(item.code as never),
    )) {
      const exists = await tx
        .select()
        .from(rolePermissions)
        .where(
          and(
            eq(rolePermissions.roleId, role.id),
            eq(rolePermissions.permissionId, permission.id),
          ),
        )
        .limit(1);
      if (!exists.length)
        await tx
          .insert(rolePermissions)
          .values({ roleId: role.id, permissionId: permission.id });
    }
  }
});
const entitlements = (
  members: number,
  brands: number,
  articles: number,
  reports: number,
  retention: number,
): PlanEntitlements => ({
  members: { limit: members, unit: "people", reset: "none" },
  brands: { limit: brands, unit: "brands", reset: "none" },
  article_generations: {
    limit: articles,
    unit: "jobs",
    reset: "billing_period",
  },
  report_exports: { limit: reports, unit: "exports", reset: "billing_period" },
  data_retention_days: { limit: retention, unit: "days", reset: "none" },
});
const catalog = [
  {
    code: "free",
    name: "默认资源配置",
    description: "内部资源上限配置，不用于收费",
    versions: [
      {
        cycle: "free" as const,
        price: 0,
        rights: entitlements(3, 1, 0, 0, 30),
      },
    ],
  },
];
let freeVersionId = "";
await db.transaction(async (tx) => {
  await tx
    .update(billingPlans)
    .set({ status: "archived", updatedAt: new Date() })
    .where(
      inArray(billingPlans.code, [
        "growth",
        "scale",
        "starter",
        "basic",
        "standard",
        "professional",
      ]),
    );
  for (const item of catalog) {
    const [plan] = await tx
      .insert(billingPlans)
      .values({
        code: item.code,
        name: item.name,
        description: item.description,
      })
      .onConflictDoUpdate({
        target: billingPlans.code,
        set: {
          name: item.name,
          description: item.description,
          status: "active",
          updatedAt: new Date(),
        },
      })
      .returning();
    for (const version of item.versions) {
      const [stored] = await tx
        .insert(billingPlanVersions)
        .values({
          planId: plan.id,
          version: 2,
          billingCycle: version.cycle,
          currency: "CNY",
          priceAmount: version.price,
          entitlements: version.rights,
          status: "published",
          publishedAt: new Date(),
        })
        .onConflictDoNothing({
          target: [
            billingPlanVersions.planId,
            billingPlanVersions.version,
            billingPlanVersions.billingCycle,
          ],
        })
        .returning();
      const selected =
        stored ??
        (
          await tx
            .select()
            .from(billingPlanVersions)
            .where(
              and(
                eq(billingPlanVersions.planId, plan.id),
                eq(billingPlanVersions.version, 2),
                eq(billingPlanVersions.billingCycle, version.cycle),
              ),
            )
            .limit(1)
        )[0];
      if (item.code === "free") freeVersionId = selected.id;
    }
  }
});
if (!freeVersionId) throw new Error("免费套餐版本初始化失败");
await db.transaction(async (tx) => {
  const tenants = await tx.select({ id: organizations.id }).from(organizations);
  for (const tenant of tenants) {
    const [active] = await tx
      .select()
      .from(platformSubscriptions)
      .where(
        and(
          eq(platformSubscriptions.organizationId, tenant.id),
          eq(platformSubscriptions.status, "active"),
        ),
      )
      .limit(1);
    if (active) continue;
    const start = new Date();
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    const [subscription] = await tx
      .insert(platformSubscriptions)
      .values({
        organizationId: tenant.id,
        planVersionId: freeVersionId,
        status: "active",
        currentPeriodStart: start,
        currentPeriodEnd: end,
      })
      .returning();
    const free = catalog[0]!.versions[0]!.rights;
    for (const [key, value] of Object.entries(free)) {
      const [snapshot] = await tx
        .insert(subscriptionEntitlements)
        .values({
          organizationId: tenant.id,
          subscriptionId: subscription.id,
          entitlementKey: key,
          limitAmount: value.limit,
          unit: value.unit,
          periodStart: start,
          periodEnd: end,
        })
        .returning();
      await tx.insert(quotaLedgers).values({
        organizationId: tenant.id,
        subscriptionId: subscription.id,
        entitlementId: snapshot.id,
        entitlementKey: key,
        operation: "grant",
        amount: value.limit ?? 0,
        balanceAfter: value.limit,
        referenceType: "subscription",
        referenceId: subscription.id,
        idempotencyKey: `subscription:${subscription.id}:grant:${key}`,
        reason: "免费套餐初始权益",
      });
    }
    await tx
      .update(organizations)
      .set({ planCode: "free", updatedAt: new Date() })
      .where(eq(organizations.id, tenant.id));
  }
});
await db
  .insert(featurePointCosts)
  .values(
    billableFeatures.map((feature) => ({
      featureCode: feature.code,
      points: feature.defaultPoints,
      description: feature.name,
    })),
  )
  .onConflictDoNothing();
await db
  .insert(pricingTierRules)
  .values([
    {
      tier: "retail",
      displayName: "普通用户",
      publicationMarkupBps: 3000,
      pointMultiplierBps: 10000,
    },
    {
      tier: "bronze",
      displayName: "铜牌代理",
      publicationMarkupBps: 2000,
      pointMultiplierBps: 9000,
    },
    {
      tier: "silver",
      displayName: "银牌代理",
      publicationMarkupBps: 1500,
      pointMultiplierBps: 8000,
    },
    {
      tier: "gold",
      displayName: "金牌代理",
      publicationMarkupBps: 1000,
      pointMultiplierBps: 7000,
    },
  ])
  .onConflictDoNothing();
await db
  .insert(publicationChannels)
  .values([
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "新闻媒体发布",
      category: "新闻媒体",
      priceAmount: 50_000,
      providerCostAmount: 50_000,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "自媒体发布",
      category: "自媒体",
      priceAmount: 20_000,
      providerCostAmount: 20_000,
    },
  ])
  .onConflictDoNothing();
await db
  .insert(systemReleaseState)
  .values({ component: "seed", version: CURRENT_SEED_VERSION })
  .onConflictDoUpdate({
    target: systemReleaseState.component,
    set: { version: CURRENT_SEED_VERSION, updatedAt: new Date() },
    setWhere: sql`
      ${systemReleaseState.version} !~ '^v[1-9][0-9]*$'
      OR substring(${systemReleaseState.version} from 2)::integer
        < substring(${CURRENT_SEED_VERSION} from 2)::integer
    `,
  });
console.info("基础角色、默认资源配置、功能积分价格和发布渠道已初始化");
await pool.end();
