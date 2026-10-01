import { and, eq, sql } from "drizzle-orm";
import {
  publicationActionPending,
  type PublicationProviderAction,
} from "@geo/core";
import { publicationOrders, publicationChannels } from "./schema";
import { withTenantDbContext, type DatabaseTransaction } from "./context";
import { assertEnterpriseAccess } from "./enterprise-access";

type ActionScope = {
  organizationId: string;
  brandId: string;
  userId: string;
  teamBindingId: string;
};
const revision = sql`greatest(date_trunc('milliseconds', clock_timestamp()), date_trunc('milliseconds', ${publicationOrders.updatedAt}) + interval '1 millisecond')`;

// @project-doc docs/domains/balance_and_publication.md#publication_state_machine
export function beginPublicationAction(
  input: ActionScope & { orderId: string; action: PublicationProviderAction },
  audit?: (tx: DatabaseTransaction) => Promise<void>,
) {
  return withTenantDbContext(input, async (tx) => {
    await assertEnterpriseAccess(input.organizationId, false, tx);
    const [order] = await tx
      .select()
      .from(publicationOrders)
      .where(
        and(
          eq(publicationOrders.id, input.orderId),
          eq(publicationOrders.organizationId, input.organizationId),
          eq(publicationOrders.brandId, input.brandId),
        ),
      )
      .for("update");
    if (!order) return { kind: "missing" as const };
    const [channel] = await tx
      .select()
      .from(publicationChannels)
      .where(eq(publicationChannels.id, order.channelId));
    if (!channel) return { kind: "missing" as const };
    if (
      (input.action.operation === "cancel" && order.status === "cancelled") ||
      (input.action.operation === "appeal" &&
        order.providerStatus === 9 &&
        ["processing", "published"].includes(order.status))
    )
      return { kind: "replayed" as const, order, channel };
    if (publicationActionPending(order.providerAction))
      return { kind: "blocked" as const, order, channel };
    if (order.providerAction?.id === input.action.id)
      return { kind: "ended" as const, order, channel };
    if (
      !(
        input.action.operation === "cancel"
          ? ["submitted", "processing"]
          : ["processing", "published"]
      ).includes(order.status)
    )
      return { kind: "invalid" as const, order, channel };
    if (
      (channel.provider === "frog_media" ||
        input.action.operation === "appeal") &&
      (channel.provider !== "frog_media" ||
        !order.providerOrderId ||
        !["website", "wemedia"].includes(channel.providerMediaType ?? ""))
    )
      return { kind: "unsupported" as const, order, channel };
    const [updated] = await tx
      .update(publicationOrders)
      .set({ providerAction: input.action, updatedAt: revision })
      .where(eq(publicationOrders.id, order.id))
      .returning();
    if (audit) await audit(tx);
    return { kind: "started" as const, order: updated!, channel };
  });
}

export function settlePublicationAction(
  input: ActionScope & {
    orderId: string;
    actionId: string;
    state: "uncertain" | "rejected";
  },
  audit?: (tx: DatabaseTransaction) => Promise<void>,
) {
  return withTenantDbContext(input, async (tx) => {
    const [order] = await tx
      .select()
      .from(publicationOrders)
      .where(
        and(
          eq(publicationOrders.id, input.orderId),
          eq(publicationOrders.organizationId, input.organizationId),
          eq(publicationOrders.brandId, input.brandId),
        ),
      )
      .for("update");
    const action = order?.providerAction;
    if (
      !action ||
      action.id !== input.actionId ||
      !publicationActionPending(action)
    )
      return undefined;
    const [updated] = await tx
      .update(publicationOrders)
      .set({
        providerAction: {
          ...action,
          state: input.state,
          ...(input.state === "rejected"
            ? { resolvedAt: new Date().toISOString() }
            : {}),
        },
        updatedAt: revision,
      })
      .where(eq(publicationOrders.id, order.id))
      .returning();
    if (audit) await audit(tx);
    return updated;
  });
}

export function dispatchPublicationAction(
  input: ActionScope & { orderId: string; actionId: string },
) {
  return withTenantDbContext(input, async (tx) => {
    const [order] = await tx
      .select()
      .from(publicationOrders)
      .where(
        and(
          eq(publicationOrders.id, input.orderId),
          eq(publicationOrders.organizationId, input.organizationId),
          eq(publicationOrders.brandId, input.brandId),
        ),
      )
      .for("update");
    const action = order?.providerAction;
    if (
      !action ||
      action.id !== input.actionId ||
      action.state !== "pending" ||
      new Date(action.expiresAt).getTime() <= Date.now() ||
      action.dispatchedAt
    )
      return false;
    await tx
      .update(publicationOrders)
      .set({
        providerAction: {
          ...action,
          dispatchedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
        },
        updatedAt: revision,
      })
      .where(eq(publicationOrders.id, order.id));
    return true;
  });
}

// @project-doc docs/domains/balance_and_publication.md#publication_state_machine
export function resolvePublicationAction(
  input: ActionScope & { orderId: string; actionId: string; note: string },
  audit: (tx: DatabaseTransaction) => Promise<void>,
) {
  return withTenantDbContext(input, async (tx) => {
    const [order] = await tx
      .select()
      .from(publicationOrders)
      .where(
        and(
          eq(publicationOrders.id, input.orderId),
          eq(publicationOrders.organizationId, input.organizationId),
          eq(publicationOrders.brandId, input.brandId),
        ),
      )
      .for("update");
    if (!order) return { kind: "missing" as const };
    const action = order.providerAction;
    if (!action || action.id !== input.actionId)
      return { kind: "conflict" as const };
    if (action.state === "released")
      return { kind: "replayed" as const, order };
    if (!publicationActionPending(action))
      return { kind: "ended" as const, order };
    if (
      action.state === "pending" &&
      new Date(action.expiresAt).getTime() > Date.now()
    )
      return { kind: "running" as const };
    const [updated] = await tx
      .update(publicationOrders)
      .set({
        providerAction: {
          ...action,
          state: "released",
          resolvedAt: new Date().toISOString(),
          resolvedBy: input.userId,
          resolutionNote: input.note,
        },
        updatedAt: revision,
      })
      .where(eq(publicationOrders.id, order.id))
      .returning();
    await audit(tx);
    return { kind: "resolved" as const, order: updated! };
  });
}
