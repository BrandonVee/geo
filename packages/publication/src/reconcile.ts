import type { FrogOrderInfo, FrogPublicationClient } from "./client";
import {
  publicationActionPending,
  type PublicationProviderAction,
} from "@geo/core";

export type PublicationSyncRow = {
  order: {
    id: string;
    status: string;
    providerOrderId: string | null;
    providerStatus: number | null;
    updatedAt: Date;
    providerAction?: PublicationProviderAction | null;
  };
  channel: {
    provider: string;
    providerMediaType: string | null;
    providerResourceId: string | null;
  };
};
export type ProviderSnapshot = {
  orderId: string;
  expectedUpdatedAt: Date;
  providerStatus: number;
  providerMessage: string;
  resultUrl?: string;
};
export type ProviderTransition = ProviderSnapshot & {
  status: "processing" | "published" | "failed";
  processedBy: null;
  providerSyncedAt: Date;
  providerSync: true;
  allowPublishedFailure?: boolean;
};
export type PublicationSyncStore = {
  updateOrder(input: ProviderTransition): Promise<unknown>;
  recordProviderSnapshot(input: ProviderSnapshot): Promise<unknown>;
};
export function publicationNeedsSync(row: PublicationSyncRow) {
  return (
    row.channel.provider === "frog_media" &&
    Boolean(row.order.providerOrderId) &&
    (["submitted", "processing"].includes(row.order.status) ||
      (row.order.status === "published" &&
        ([9, 4].includes(row.order.providerStatus ?? -1) ||
          publicationActionPending(row.order.providerAction))))
  );
}

export async function reconcilePublicationOrders(
  rows: PublicationSyncRow[],
  client: Pick<FrogPublicationClient, "configured" | "orderInfo">,
  store: PublicationSyncStore,
) {
  const result = { checked: 0, errors: 0, skipped: !client.configured };
  if (!client.configured) return result;
  for (const mediaType of ["website", "wemedia"] as const) {
    const pending = rows.filter(
      (row) =>
        publicationNeedsSync(row) &&
        row.channel.providerMediaType === mediaType,
    );
    for (let offset = 0; offset < pending.length; offset += 20) {
      const batch = pending.slice(offset, offset + 20);
      let details: FrogOrderInfo[];
      try {
        details = await client.orderInfo(
          mediaType,
          batch.map((row) => row.order.providerOrderId!),
        );
      } catch {
        result.errors += batch.length;
        continue;
      }
      for (const row of batch) {
        const info = details.find(
          (item) =>
            item.order_nid === row.order.providerOrderId &&
            item.resource_id === row.channel.providerResourceId,
        );
        if (!info) {
          result.errors += 1;
          continue;
        }
        const snapshot: ProviderSnapshot = {
          orderId: row.order.id,
          expectedUpdatedAt: row.order.updatedAt,
          providerStatus: info.status,
          providerMessage: [
            info.rejection_info,
            info.refund_info,
            info.rewrite_info,
            info.remark,
          ]
            .filter(Boolean)
            .join("；")
            .slice(0, 2000),
          ...(info.order_url ? { resultUrl: info.order_url } : {}),
        };
        const status =
          info.status === 4 &&
          (row.order.status !== "published" || info.is_refund === 1)
            ? "failed"
            : info.status === 2 && info.order_url
              ? "published"
              : [0, 1, 9].includes(info.status) &&
                  row.order.status === "submitted"
                ? "processing"
                : undefined;
        try {
          if (status && status !== row.order.status)
            await store.updateOrder({
              ...snapshot,
              status,
              processedBy: null,
              providerSyncedAt: new Date(),
              providerSync: true,
              allowPublishedFailure:
                row.order.status === "published" && info.is_refund === 1,
            });
          else await store.recordProviderSnapshot(snapshot);
          result.checked += 1;
        } catch {
          result.errors += 1;
        }
      }
    }
  }
  return result;
}
