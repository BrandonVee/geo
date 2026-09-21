import { describe, it, expect, vi } from "vitest";
import {
  reconcilePublicationOrders,
  type PublicationSyncRow,
} from "./reconcile";
const row: PublicationSyncRow = {
  order: {
    id: "local",
    status: "processing",
    providerOrderId: "upstream",
    providerStatus: 1,
    updatedAt: new Date(),
  },
  channel: {
    provider: "frog_media",
    providerMediaType: "website",
    providerResourceId: "resource",
  },
};
function fixture(status: number, is_refund = 0, order_url = "") {
  const client = {
    configured: true,
    orderInfo: vi.fn().mockResolvedValue([
      {
        order_nid: "upstream",
        resource_id: "resource",
        status,
        is_refund,
        order_url,
      },
    ]),
  };
  const store = { updateOrder: vi.fn(), recordProviderSnapshot: vi.fn() };
  return { client, store };
}
describe("聚合发布后台履约", () => {
  it("无人打开页面时同样同步完成，并以读取版本隔离迟到响应", async () => {
    const { client, store } = fixture(2, 0, "https://example.com/article");
    expect(
      await reconcilePublicationOrders([row], client, store),
    ).toMatchObject({ checked: 1, errors: 0 });
    expect(store.updateOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "published",
        expectedUpdatedAt: row.order.updatedAt,
        providerSync: true,
      }),
    );
  });
  it("退稿尚未到账继续查询，到账后才返还已发布订单", async () => {
    const pending = {
      ...row,
      order: { ...row.order, status: "published", providerStatus: 4 },
    };
    const { client, store } = fixture(4);
    await reconcilePublicationOrders([pending], client, store);
    expect(store.updateOrder).not.toHaveBeenCalled();
    client.orderInfo.mockResolvedValue([
      {
        order_nid: "upstream",
        resource_id: "resource",
        status: 4,
        is_refund: 1,
      },
    ]);
    await reconcilePublicationOrders([pending], client, store);
    expect(store.updateOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        allowPublishedFailure: true,
      }),
    );
  });
  it("错误媒体匹配不改变订单或资金", async () => {
    const { client, store } = fixture(4);
    client.orderInfo.mockResolvedValue([
      { order_nid: "upstream", resource_id: "other", status: 4 },
    ]);
    expect(
      await reconcilePublicationOrders([row], client, store),
    ).toMatchObject({ errors: 1 });
    expect(store.updateOrder).not.toHaveBeenCalled();
  });
  it("无 Key 不触发请求，失败报告错误而不假报成功", async () => {
    const { client, store } = fixture(4);
    client.configured = false;
    expect(
      await reconcilePublicationOrders([row], client, store),
    ).toMatchObject({ skipped: true });
    expect(client.orderInfo).not.toHaveBeenCalled();
    client.configured = true;
    client.orderInfo.mockRejectedValue(new Error("timeout"));
    expect(
      await reconcilePublicationOrders([row], client, store),
    ).toMatchObject({ errors: 1, checked: 0 });
    expect(store.updateOrder).not.toHaveBeenCalled();
  });
  it("分批查询，单批失败不阻塞其他订单", async () => {
    const { client, store } = fixture(1);
    const rows = Array.from({ length: 21 }, () => row);
    client.orderInfo.mockRejectedValueOnce(new Error("timeout"));
    expect(await reconcilePublicationOrders(rows, client, store)).toMatchObject(
      { errors: 20, checked: 1 },
    );
    expect(client.orderInfo).toHaveBeenCalledTimes(2);
  });
});
