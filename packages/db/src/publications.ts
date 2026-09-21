import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  ilike,
  inArray,
  isNotNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { db } from "./client";
import {
  balanceAccounts,
  balanceTransactions,
  publicationChannels,
  publicationChannelPriceOverrides,
  publicationOrders,
  pricingTierRules,
  users,
} from "./schema";
import type { PricingTier } from "./pricing";

const pricingTiers = ["retail", "bronze", "silver", "gold"] as const;

const fallbackPricingRules = {
  retail: { publicationMarkupBps: 3000, displayName: "普通用户" },
  bronze: { publicationMarkupBps: 2000, displayName: "铜牌代理" },
  silver: { publicationMarkupBps: 1500, displayName: "银牌代理" },
  gold: { publicationMarkupBps: 1000, displayName: "金牌代理" },
} as const;

const calculateChannelPrice = (
  channel: typeof publicationChannels.$inferSelect,
  markupBps: number,
  override?: number,
) =>
  override ??
  (channel.provider === "frog_media"
    ? Math.ceil((channel.providerCostAmount * (10_000 + markupBps)) / 10_000)
    : channel.priceAmount);

async function enrichChannelPricing(
  rows: Array<typeof publicationChannels.$inferSelect>,
) {
  if (!rows.length) return [];
  const [rules, overrides] = await Promise.all([
    db.select().from(pricingTierRules),
    db
      .select()
      .from(publicationChannelPriceOverrides)
      .where(
        inArray(
          publicationChannelPriceOverrides.channelId,
          rows.map((row) => row.id),
        ),
      ),
  ]);
  const ruleMap = new Map(rules.map((rule) => [rule.tier, rule]));
  const overrideMap = new Map(
    overrides.map((row) => [`${row.channelId}:${row.tier}`, row.priceAmount]),
  );
  return rows.map((row) => {
    const tierPrices = Object.fromEntries(
      pricingTiers.map((tier) => {
        const rule = ruleMap.get(tier) ?? fallbackPricingRules[tier];
        const override = overrideMap.get(`${row.id}:${tier}`);
        return [
          tier,
          {
            priceAmount: calculateChannelPrice(
              row,
              rule.publicationMarkupBps,
              override,
            ),
            overridden: override !== undefined,
          },
        ];
      }),
    ) as Record<PricingTier, { priceAmount: number; overridden: boolean }>;
    return { ...row, priceAmount: tierPrices.retail.priceAmount, tierPrices };
  });
}

export type ProviderPublicationChannelInput = {
  providerResourceId: string;
  providerMediaType: "website" | "wemedia";
  name: string;
  category: string;
  priceAmount: number;
  status: "active" | "inactive";
  remarks: string;
  caseLink?: string;
  providerMetadata: Record<string, unknown>;
};

export function listPublicationChannels(activeOnly = true) {
  return db
    .select()
    .from(publicationChannels)
    .where(
      activeOnly
        ? and(
            eq(publicationChannels.status, "active"),
            eq(publicationChannels.providerStatus, "active"),
          )
        : undefined,
    )
    .orderBy(publicationChannels.category, publicationChannels.name);
}
export async function listPublicationChannelsPage(input: {
  page: number;
  pageSize: number;
  activeOnly?: boolean;
  q?: string;
  status?: "active" | "inactive";
  provider?: "frog_media" | "manual";
  mediaType?: "website" | "wemedia" | "manual";
  maxPriceAmount?: number;
  field1?: string;
  field2?: string;
  field3?: string;
  field4?: string;
  field5?: string;
  field6?: string;
  field7?: string;
  field8?: string;
  field9?: string;
  sort?: "recommended" | "priceAsc" | "priceDesc" | "rateDesc" | "speedAsc";
  category?: string;
  pricingTier?: PricingTier;
  includeTierPrices?: boolean;
}) {
  const tier = input.pricingTier ?? "retail";
  const [storedRule] = await db
    .select({ publicationMarkupBps: pricingTierRules.publicationMarkupBps })
    .from(pricingTierRules)
    .where(eq(pricingTierRules.tier, tier))
    .limit(1);
  const markupBps =
    storedRule?.publicationMarkupBps ??
    fallbackPricingRules[tier].publicationMarkupBps;
  const overridePrice = sql<number>`(
    select ${publicationChannelPriceOverrides.priceAmount}
    from ${publicationChannelPriceOverrides}
    where ${publicationChannelPriceOverrides.channelId} = ${publicationChannels.id}
      and ${publicationChannelPriceOverrides.tier} = ${tier}
    limit 1
  )`;
  const effectivePrice = sql<number>`coalesce(
    ${overridePrice},
    case when ${publicationChannels.provider} = 'frog_media'
      then ceil(${publicationChannels.providerCostAmount} * (10000 + ${markupBps}) / 10000.0)::int
      else ${publicationChannels.priceAmount}
    end
  )`;
  const conditions = [];
  if (input.activeOnly) {
    conditions.push(eq(publicationChannels.status, "active"));
    conditions.push(eq(publicationChannels.providerStatus, "active"));
  } else if (input.status)
    conditions.push(eq(publicationChannels.status, input.status));
  if (input.provider)
    conditions.push(eq(publicationChannels.provider, input.provider));
  if (input.mediaType === "manual")
    conditions.push(eq(publicationChannels.provider, "manual"));
  else if (input.mediaType)
    conditions.push(eq(publicationChannels.providerMediaType, input.mediaType));
  if (input.category)
    conditions.push(eq(publicationChannels.category, input.category));
  if (input.maxPriceAmount !== undefined)
    conditions.push(lte(effectivePrice, input.maxPriceAmount));
  const metadataFields = [
    input.field1,
    input.field2,
    input.field3,
    input.field4,
    input.field5,
    input.field6,
    input.field7,
    input.field8,
    input.field9,
  ];
  metadataFields.forEach((value, index) => {
    if (!value) return;
    const fieldKey = `field_${index + 1}`;
    conditions.push(
      sql`coalesce(${publicationChannels.providerMetadata}->'fieldTitles'->${fieldKey}, '[]'::jsonb) @> ${JSON.stringify([value])}::jsonb`,
    );
  });
  if (input.q) {
    const pattern = `%${input.q}%`;
    conditions.push(
      or(
        ilike(publicationChannels.name, pattern),
        ilike(publicationChannels.category, pattern),
        ilike(publicationChannels.remarks, pattern),
        sql`${publicationChannels.providerMetadata}::text ilike ${pattern}`,
      )!,
    );
  }
  const where = conditions.length ? and(...conditions) : undefined;
  const orderBy =
    input.sort === "priceAsc"
      ? [asc(effectivePrice), asc(publicationChannels.name)]
      : input.sort === "priceDesc"
        ? [desc(effectivePrice), asc(publicationChannels.name)]
        : input.sort === "rateDesc"
          ? [
              sql`case when ${publicationChannels.providerMetadata}->>'publishRate' ~ '^[0-9]+(?:\\.[0-9]+)?$' then (${publicationChannels.providerMetadata}->>'publishRate')::numeric end desc nulls last`,
              asc(publicationChannels.name),
            ]
          : input.sort === "speedAsc"
            ? [
                sql`case when ${publicationChannels.providerMetadata}->>'publishTimeSeconds' ~ '^[0-9]+$' then (${publicationChannels.providerMetadata}->>'publishTimeSeconds')::bigint end asc nulls last`,
                asc(publicationChannels.name),
              ]
            : [
                asc(publicationChannels.category),
                asc(publicationChannels.name),
              ];
  const [{ total }] = await db
    .select({ total: count() })
    .from(publicationChannels)
    .where(where);
  const listWithEffectivePrice = await db
    .select({
      ...getTableColumns(publicationChannels),
      effectivePriceAmount: effectivePrice,
    })
    .from(publicationChannels)
    .where(where)
    .orderBy(...orderBy)
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);
  const baseRows = listWithEffectivePrice.map(
    ({ effectivePriceAmount, ...row }) => ({
      ...row,
      priceAmount: effectivePriceAmount,
    }),
  );
  const list = input.includeTierPrices
    ? await enrichChannelPricing(
        listWithEffectivePrice.map(
          ({ effectivePriceAmount: _, ...row }) => row,
        ),
      )
    : baseRows;
  return {
    list,
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      total,
      pages: Math.ceil(total / input.pageSize),
    },
  };
}
export async function upsertPublicationChannel(input: {
  id?: string;
  name: string;
  category: string;
  priceAmount: number;
  status?: "active" | "inactive";
  tierPrices?: Record<PricingTier, number | null>;
  updatedBy?: string;
}) {
  return db.transaction(async (tx) => {
    const [existing] = input.id
      ? await tx
          .select({ provider: publicationChannels.provider })
          .from(publicationChannels)
          .where(eq(publicationChannels.id, input.id))
          .limit(1)
      : [];
    const values = {
      name: input.name,
      category: input.category,
      priceAmount: input.priceAmount,
      ...(existing?.provider === "frog_media"
        ? {}
        : { providerCostAmount: input.priceAmount }),
      status: input.status ?? ("active" as const),
      updatedAt: new Date(),
    };
    const [row] = input.id
      ? await tx
          .update(publicationChannels)
          .set(values)
          .where(eq(publicationChannels.id, input.id))
          .returning()
      : await tx.insert(publicationChannels).values(values).returning();
    if (!row) return undefined;
    if (input.tierPrices) {
      for (const tier of pricingTiers) {
        const priceAmount = input.tierPrices[tier];
        if (priceAmount === null) {
          await tx
            .delete(publicationChannelPriceOverrides)
            .where(
              and(
                eq(publicationChannelPriceOverrides.channelId, row.id),
                eq(publicationChannelPriceOverrides.tier, tier),
              ),
            );
        } else {
          await tx
            .insert(publicationChannelPriceOverrides)
            .values({
              channelId: row.id,
              tier,
              priceAmount,
              updatedBy: input.updatedBy,
            })
            .onConflictDoUpdate({
              target: [
                publicationChannelPriceOverrides.channelId,
                publicationChannelPriceOverrides.tier,
              ],
              set: {
                priceAmount,
                updatedBy: input.updatedBy,
                updatedAt: new Date(),
              },
            });
        }
      }
    }
    return row;
  });
}
export async function upsertProviderPublicationChannels(
  rows: ProviderPublicationChannelInput[],
) {
  if (rows.length === 0) return [];
  return db.transaction(async (tx) => {
    const result: (typeof publicationChannels.$inferSelect)[] = [];
    for (let offset = 0; offset < rows.length; offset += 200) {
      const batch = rows.slice(offset, offset + 200);
      const saved = await tx
        .insert(publicationChannels)
        .values(
          batch.map((row) => ({
            ...row,
            provider: "frog_media",
            providerCostAmount: row.priceAmount,
            providerStatus: row.status,
            status: "active" as const,
            currency: "CNY",
          })),
        )
        .onConflictDoUpdate({
          target: [
            publicationChannels.provider,
            publicationChannels.providerMediaType,
            publicationChannels.providerResourceId,
          ],
          set: {
            name: sql`excluded."name"`,
            category: sql`excluded."category"`,
            priceAmount: sql`excluded."price_amount"`,
            providerCostAmount: sql`excluded."provider_cost_amount"`,
            providerStatus: sql`excluded."provider_status"`,
            remarks: sql`excluded."remarks"`,
            caseLink: sql`excluded."case_link"`,
            providerMetadata: sql`excluded."provider_metadata"`,
            updatedAt: new Date(),
          },
        })
        .returning();
      result.push(...saved);
    }
    return result;
  });
}
export async function findPublicationChannel(channelId: string) {
  const [row] = await db
    .select()
    .from(publicationChannels)
    .where(eq(publicationChannels.id, channelId))
    .limit(1);
  return row;
}
export async function findPublicationChannelForUser(
  channelId: string,
  userId: string,
) {
  const channel = await findPublicationChannel(channelId);
  if (!channel) return undefined;
  const [user] = await db
    .select({ pricingTier: users.pricingTier })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const tier = user?.pricingTier ?? "retail";
  const [[rule], [override]] = await Promise.all([
    db
      .select({ publicationMarkupBps: pricingTierRules.publicationMarkupBps })
      .from(pricingTierRules)
      .where(eq(pricingTierRules.tier, tier))
      .limit(1),
    db
      .select({ priceAmount: publicationChannelPriceOverrides.priceAmount })
      .from(publicationChannelPriceOverrides)
      .where(
        and(
          eq(publicationChannelPriceOverrides.channelId, channelId),
          eq(publicationChannelPriceOverrides.tier, tier),
        ),
      )
      .limit(1),
  ]);
  return {
    ...channel,
    pricingTier: tier,
    priceAmount: calculateChannelPrice(
      channel,
      rule?.publicationMarkupBps ??
        fallbackPricingRules[tier].publicationMarkupBps,
      override?.priceAmount,
    ),
  };
}
export function listPublicationOrders(organizationId?: string) {
  return db
    .select({ order: publicationOrders, channel: publicationChannels })
    .from(publicationOrders)
    .innerJoin(
      publicationChannels,
      eq(publicationChannels.id, publicationOrders.channelId),
    )
    .where(
      organizationId
        ? eq(publicationOrders.organizationId, organizationId)
        : undefined,
    )
    .orderBy(desc(publicationOrders.createdAt));
}
// @project-doc docs/domains/balance_and_publication.md#publication_state_machine
export async function createPublicationOrderWithBalance(input: {
  organizationId: string;
  brandId: string;
  channelId: string;
  title: string;
  contentUrl?: string;
  contentHtml?: string;
  sourceJobId?: string;
  sourceDocumentId?: string;
  note: string;
  idempotencyKey: string;
  createdBy: string;
}) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${input.organizationId}), hashtext(${input.idempotencyKey}))`,
    );
    const [replay] = await tx
      .select()
      .from(publicationOrders)
      .where(
        and(
          eq(publicationOrders.organizationId, input.organizationId),
          eq(publicationOrders.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (
      replay &&
      (replay.brandId !== input.brandId ||
        replay.channelId !== input.channelId ||
        replay.title !== input.title ||
        replay.createdBy !== input.createdBy ||
        (replay.sourceJobId ?? undefined) !== input.sourceJobId ||
        (replay.sourceDocumentId ?? undefined) !== input.sourceDocumentId ||
        (replay.contentUrl ?? undefined) !== input.contentUrl)
    )
      return { ok: false as const, code: "IDEMPOTENCY_CONFLICT" as const };
    if (replay)
      return { ok: true as const, order: replay, replayed: true as const };
    const [channel] = await tx
      .select()
      .from(publicationChannels)
      .where(
        and(
          eq(publicationChannels.id, input.channelId),
          eq(publicationChannels.status, "active"),
        ),
      )
      .limit(1);
    if (!channel)
      return { ok: false as const, code: "CHANNEL_NOT_FOUND" as const };
    if (channel.providerStatus !== "active")
      return { ok: false as const, code: "CHANNEL_NOT_FOUND" as const };
    const [actor] = await tx
      .select({ pricingTier: users.pricingTier })
      .from(users)
      .where(eq(users.id, input.createdBy))
      .limit(1);
    const tier = actor?.pricingTier ?? "retail";
    const [[rule], [override]] = await Promise.all([
      tx
        .select({
          publicationMarkupBps: pricingTierRules.publicationMarkupBps,
        })
        .from(pricingTierRules)
        .where(eq(pricingTierRules.tier, tier))
        .limit(1),
      tx
        .select({ priceAmount: publicationChannelPriceOverrides.priceAmount })
        .from(publicationChannelPriceOverrides)
        .where(
          and(
            eq(publicationChannelPriceOverrides.channelId, channel.id),
            eq(publicationChannelPriceOverrides.tier, tier),
          ),
        )
        .limit(1),
    ]);
    const chargePriceAmount = calculateChannelPrice(
      channel,
      rule?.publicationMarkupBps ??
        fallbackPricingRules[tier].publicationMarkupBps,
      override?.priceAmount,
    );
    await tx
      .insert(balanceAccounts)
      .values({
        organizationId: input.organizationId,
        brandId: input.brandId,
        asset: "publication_cny",
      })
      .onConflictDoNothing();
    const [account] = await tx
      .select()
      .from(balanceAccounts)
      .where(
        and(
          eq(balanceAccounts.organizationId, input.organizationId),
          eq(balanceAccounts.brandId, input.brandId),
          eq(balanceAccounts.asset, "publication_cny"),
        ),
      )
      .limit(1);
    if (!account) throw new Error("BALANCE_ACCOUNT_NOT_FOUND");
    const [debited] = await tx
      .update(balanceAccounts)
      .set({
        balance: sql`${balanceAccounts.balance} - ${chargePriceAmount}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(balanceAccounts.id, account.id),
          sql`${balanceAccounts.balance} >= ${chargePriceAmount}`,
        ),
      )
      .returning();
    if (!debited)
      return { ok: false as const, code: "INSUFFICIENT_BALANCE" as const };
    const { contentHtml: _contentHtml, ...orderInput } = input;
    const [order] = await tx
      .insert(publicationOrders)
      .values({
        ...orderInput,
        priceAmount: chargePriceAmount,
        currency: "CNY",
      })
      .returning();
    if (chargePriceAmount > 0)
      await tx.insert(balanceTransactions).values({
        organizationId: input.organizationId,
        asset: "publication_cny",
        operation: "consume",
        amount: chargePriceAmount,
        sourceAccountId: account.id,
        sourceBalanceAfter: debited.balance,
        referenceType: "publication_order",
        referenceId: order!.id,
        idempotencyKey: `publication:${order!.id}:consume`,
        reason: `发布订单：${channel.name}（${tier}）`,
        actorUserId: input.createdBy,
      });
    return { ok: true as const, order: order!, replayed: false as const };
  });
}
export async function updatePublicationOrder(input: {
  orderId: string;
  status: "processing" | "published" | "failed" | "cancelled";
  resultUrl?: string;
  note?: string;
  processedBy: string | null;
  providerOrderId?: string;
  providerStatus?: number;
  providerMessage?: string;
  providerSyncedAt?: Date;
  allowPublishedFailure?: boolean;
  providerSync?: boolean;
  expectedUpdatedAt?: Date;
}) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(publicationOrders)
      .where(eq(publicationOrders.id, input.orderId))
      .limit(1);
    if (!current) return undefined;
    const allowed: string[] =
      current.status === "submitted"
        ? [
            "processing",
            "failed",
            "cancelled",
            ...(input.providerSync ? ["published"] : []),
          ]
        : current.status === "processing"
          ? ["published", "failed", "cancelled"]
          : current.status === "published" && input.allowPublishedFailure
            ? ["failed"]
            : [];
    if (!allowed.includes(input.status)) return null;
    if (input.status === "published" && !input.resultUrl) return null;
    const [updated] = await tx
      .update(publicationOrders)
      .set({
        status: input.status,
        resultUrl: input.resultUrl,
        note: input.note ?? current.note,
        processedBy: input.processedBy,
        processedAt: new Date(),
        ...(input.providerOrderId !== undefined
          ? { providerOrderId: input.providerOrderId }
          : {}),
        ...(input.providerStatus !== undefined
          ? { providerStatus: input.providerStatus }
          : {}),
        ...(input.providerMessage !== undefined
          ? { providerMessage: input.providerMessage }
          : {}),
        ...(input.providerSyncedAt !== undefined
          ? { providerSyncedAt: input.providerSyncedAt }
          : {}),
        // JS Date has millisecond precision; each revision must still advance.
        updatedAt: sql`greatest(date_trunc('milliseconds', clock_timestamp()), date_trunc('milliseconds', ${publicationOrders.updatedAt}) + interval '1 millisecond')`,
      })
      .where(
        and(
          eq(publicationOrders.id, current.id),
          eq(publicationOrders.status, current.status),
          input.expectedUpdatedAt
            ? sql`date_trunc('milliseconds', ${publicationOrders.updatedAt}) = ${input.expectedUpdatedAt.toISOString()}::timestamptz`
            : undefined,
        ),
      )
      .returning();
    if (!updated) return null;
    if (
      current.priceAmount > 0 &&
      (input.status === "failed" || input.status === "cancelled")
    ) {
      const [account] = await tx
        .select()
        .from(balanceAccounts)
        .where(
          and(
            eq(balanceAccounts.organizationId, current.organizationId),
            eq(balanceAccounts.brandId, current.brandId),
            eq(balanceAccounts.asset, "publication_cny"),
          ),
        )
        .limit(1);
      if (!account) throw new Error("BALANCE_ACCOUNT_NOT_FOUND");
      const [credited] = await tx
        .update(balanceAccounts)
        .set({
          balance: sql`${balanceAccounts.balance} + ${current.priceAmount}`,
          updatedAt: new Date(),
        })
        .where(eq(balanceAccounts.id, account.id))
        .returning();
      await tx
        .insert(balanceTransactions)
        .values({
          organizationId: current.organizationId,
          asset: "publication_cny",
          operation: "restore",
          amount: current.priceAmount,
          targetAccountId: account.id,
          targetBalanceAfter: credited!.balance,
          referenceType: "publication_order",
          referenceId: current.id,
          idempotencyKey: `publication:${current.id}:restore`,
          reason: input.status === "failed" ? "发布失败返还" : "发布取消返还",
          actorUserId: input.processedBy,
        })
        .onConflictDoNothing();
    }
    return updated;
  });
}

export async function recordPublicationProviderSnapshot(input: {
  orderId: string;
  providerOrderId?: string;
  providerStatus?: number;
  providerMessage?: string;
  resultUrl?: string;
  expectedUpdatedAt?: Date;
}) {
  const [row] = await db
    .update(publicationOrders)
    .set({
      ...(input.providerOrderId !== undefined
        ? { providerOrderId: input.providerOrderId }
        : {}),
      ...(input.providerStatus !== undefined
        ? { providerStatus: input.providerStatus }
        : {}),
      ...(input.providerMessage !== undefined
        ? { providerMessage: input.providerMessage }
        : {}),
      ...(input.resultUrl !== undefined ? { resultUrl: input.resultUrl } : {}),
      providerSyncedAt: new Date(),
      updatedAt: sql`greatest(date_trunc('milliseconds', clock_timestamp()), date_trunc('milliseconds', ${publicationOrders.updatedAt}) + interval '1 millisecond')`,
    })
    .where(
      and(
        eq(publicationOrders.id, input.orderId),
        input.expectedUpdatedAt
          ? sql`date_trunc('milliseconds', ${publicationOrders.updatedAt}) = ${input.expectedUpdatedAt.toISOString()}::timestamptz`
          : undefined,
      ),
    )
    .returning();
  return row;
}

export async function findPublicationOrderWithChannel(
  orderId: string,
  organizationId?: string,
) {
  const [row] = await db
    .select({ order: publicationOrders, channel: publicationChannels })
    .from(publicationOrders)
    .innerJoin(
      publicationChannels,
      eq(publicationChannels.id, publicationOrders.channelId),
    )
    .where(
      organizationId
        ? and(
            eq(publicationOrders.id, orderId),
            eq(publicationOrders.organizationId, organizationId),
          )
        : eq(publicationOrders.id, orderId),
    )
    .limit(1);
  return row;
}

export async function findPublicationOrderByIdempotency(
  organizationId: string,
  idempotencyKey: string,
) {
  const [row] = await db
    .select()
    .from(publicationOrders)
    .where(
      and(
        eq(publicationOrders.organizationId, organizationId),
        eq(publicationOrders.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return row;
}
export function listPendingProviderPublicationOrders() {
  return db
    .select({ order: publicationOrders, channel: publicationChannels })
    .from(publicationOrders)
    .innerJoin(
      publicationChannels,
      eq(publicationChannels.id, publicationOrders.channelId),
    )
    .where(
      and(
        eq(publicationChannels.provider, "frog_media"),
        isNotNull(publicationOrders.providerOrderId),
        or(
          inArray(publicationOrders.status, ["submitted", "processing"]),
          and(
            eq(publicationOrders.status, "published"),
            inArray(publicationOrders.providerStatus, [4, 9]),
          ),
        ),
      ),
    )
    .orderBy(
      sql`${publicationOrders.providerSyncedAt} asc nulls first`,
      asc(publicationOrders.createdAt),
    )
    .limit(100);
}
