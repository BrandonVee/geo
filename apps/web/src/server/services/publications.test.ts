import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  findByIdempotency: vi.fn(),
  findChannel: vi.fn(),
  findChannelForUser: vi.fn(),
  createOrder: vi.fn(),
  updateOrder: vi.fn(),
  recordProviderSnapshot: vi.fn(),
  findOrder: vi.fn(),
  submit: vi.fn(),
  cancel: vi.fn(),
  appeal: vi.fn(),
  getBalance: vi.fn(),
  listMedia: vi.fn(),
  listMediaFields: vi.fn(),
  channelPage: vi.fn(),
  upsertProviderChannels: vi.fn(),
  findDocument: vi.fn(),
  resolveFrogClient: vi.fn(),
  writeAudit: vi.fn(),
}));
vi.mock("@/server/repositories/publications", () => ({
  publicationRepository: m,
}));
vi.mock("@/server/repositories/articles", () => ({
  articleRepository: { findJob: vi.fn() },
}));
vi.mock("@/server/repositories/content-documents", () => ({
  contentDocumentRepository: { find: m.findDocument },
}));
vi.mock("@/server/repositories/pricing", () => ({
  pricingRepository: { userTier: vi.fn().mockResolvedValue("retail") },
}));
vi.mock("@/server/permissions/brand-scope", () => ({
  authorizeBrand: vi.fn(),
}));
vi.mock("@/server/permissions/platform", () => ({
  requirePlatformPermission: vi.fn(),
}));
vi.mock("@/server/audit/write-audit", () => ({ writeAudit: m.writeAudit }));
vi.mock("./organizations", () => ({
  organizationService: { authorize: vi.fn() },
}));
vi.mock("@/server/http/errors", () => ({
  ApiError: class extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/server/integrations/frog-publication/client", async () => {
  const actual = await import("@geo/publication");
  return {
    ...actual,
    frogPublicationClient: {
      configured: true,
      submit: m.submit,
      cancel: m.cancel,
      appeal: m.appeal,
      getBalance: m.getBalance,
    },
  };
});
vi.mock("@/server/integrations/frog-publication/configuration", () => ({
  resolveFrogPublicationClient: m.resolveFrogClient,
}));
import { publicationService } from "./publications";
import { FrogPublicationError } from "@geo/publication";
const input = {
  organizationId: "org",
  teamBindingId: "team",
  brandId: "brand",
  channelId: "channel",
  title: "标题",
  contentHtml: "<p>正文</p>",
  note: "",
  idempotencyKey: "idem",
};
const audit = { actorUserId: "user", requestId: "request" };
const channel = {
  id: "channel",
  status: "active",
  providerStatus: "active",
  provider: "frog_media",
  providerMediaType: "website",
  providerResourceId: "resource",
  priceAmount: 100,
  providerCostAmount: 80,
};
const order = {
  ...input,
  id: "order",
  status: "submitted",
  createdBy: "user",
  providerOrderId: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  m.findChannel.mockResolvedValue(channel);
  m.findChannelForUser.mockResolvedValue(channel);
  m.createOrder.mockResolvedValue({ ok: true, order, replayed: false });
  m.writeAudit.mockResolvedValue(undefined);
  m.submit.mockResolvedValue({ order_nid: "upstream" });
  m.updateOrder.mockResolvedValue({
    ...order,
    status: "processing",
    providerOrderId: "upstream",
  });
  m.findOrder.mockResolvedValue({ order, channel });
  m.getBalance.mockResolvedValue({ power_count: 81, money: "12.35" });
  m.listMedia.mockResolvedValue([]);
  m.listMediaFields.mockResolvedValue([]);
  m.channelPage.mockResolvedValue({
    list: [],
    pagination: { page: 1, pageSize: 12, total: 0, pages: 0 },
  });
  m.upsertProviderChannels.mockResolvedValue([]);
  m.resolveFrogClient.mockResolvedValue({
    configured: true,
    submit: m.submit,
    cancel: m.cancel,
    appeal: m.appeal,
    getBalance: m.getBalance,
    listMedia: m.listMedia,
    listMediaFields: m.listMediaFields,
  });
});
describe("发布业务闭环", () => {
  it("渠道页面立即读取分页缓存，不等待完整上游目录", async () => {
    const page = {
      list: [channel],
      pagination: { page: 1, pageSize: 12, total: 20_000, pages: 1667 },
    };
    m.channelPage.mockResolvedValue(page);
    await expect(
      publicationService.channels(
        { page: 1, pageSize: 12, sort: "recommended" },
        "user",
      ),
    ).resolves.toEqual(page);
    expect(m.channelPage).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 12,
        provider: "frog_media",
      }),
    );
    expect(m.listMedia).not.toHaveBeenCalled();
  });
  it("把小青蛙平台余额转换为本地人民币分", async () => {
    await expect(publicationService.providerBalance("user")).resolves.toEqual(
      expect.objectContaining({
        configured: true,
        moneyAmount: 1235,
        powerCount: 81,
      }),
    );
  });
  it("小青蛙平台余额明确不足时不扣本地品牌余额", async () => {
    m.getBalance.mockResolvedValue({ power_count: 81, money: "0.79" });
    await expect(
      publicationService.create(input, "user", audit),
    ).rejects.toMatchObject({
      code: "FROG_PUBLICATION_BALANCE_INSUFFICIENT",
    });
    expect(m.createOrder).not.toHaveBeenCalled();
    expect(m.submit).not.toHaveBeenCalled();
  });
  it("幂等重放不受后续渠道下架影响，也不再投稿扣款", async () => {
    m.findByIdempotency.mockResolvedValue(order);
    expect(await publicationService.create(input, "user", audit)).toMatchObject(
      { replayed: true },
    );
    expect(m.findChannel).not.toHaveBeenCalled();
    expect(m.submit).not.toHaveBeenCalled();
    expect(m.createOrder).not.toHaveBeenCalled();
  });
  it("聚合投稿成功后保存上游订单号并进入履约中", async () => {
    await expect(
      publicationService.create(input, "user", audit),
    ).resolves.toEqual(
      expect.objectContaining({
        order: expect.objectContaining({
          status: "processing",
          providerOrderId: "upstream",
        }),
      }),
    );
    expect(m.submit).toHaveBeenCalledWith("website", {
      resourceId: "resource",
      title: "标题",
      content: "<p>正文</p>",
      remark: undefined,
      thirdId: "order",
    });
    expect(m.updateOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order",
        status: "processing",
        providerOrderId: "upstream",
        providerStatus: 0,
      }),
    );
  });
  it("从当前品牌已定稿文档读取正文投稿", async () => {
    m.findDocument.mockResolvedValue({
      id: "document",
      status: "ready",
      body: "<p>文档库正文</p>",
    });
    await publicationService.create(
      {
        ...input,
        contentHtml: undefined,
        sourceDocumentId: "8a951454-70d8-44fb-8854-4cbbce2d57d7",
      },
      "user",
      audit,
    );
    expect(m.findDocument).toHaveBeenCalledWith(
      {
        organizationId: "org",
        teamBindingId: "team",
        brandId: "brand",
      },
      "8a951454-70d8-44fb-8854-4cbbce2d57d7",
    );
    expect(m.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        contentHtml: "<p>文档库正文</p>",
        sourceDocumentId: "8a951454-70d8-44fb-8854-4cbbce2d57d7",
      }),
    );
    expect(m.submit).toHaveBeenCalledWith(
      "website",
      expect.objectContaining({ content: "<p>文档库正文</p>" }),
    );
  });
  it("其他品牌或操作者的幂等键不返回订单", async () => {
    m.findByIdempotency.mockResolvedValue({ ...order, brandId: "other" });
    await expect(
      publicationService.create(input, "user", audit),
    ).rejects.toMatchObject({ code: "PUBLICATION_IDEMPOTENCY_CONFLICT" });
  });
  it("上游超时不退款也不重投", async () => {
    m.submit.mockRejectedValue(
      new FrogPublicationError("timeout", "send", "timeout"),
    );
    await expect(
      publicationService.create(input, "user", audit),
    ).rejects.toMatchObject({ code: "FROG_PUBLICATION_RESULT_UNCERTAIN" });
    expect(m.submit).toHaveBeenCalledTimes(1);
    expect(m.updateOrder).not.toHaveBeenCalled();
  });
  it("明确拒稿推进失败补偿", async () => {
    m.submit.mockRejectedValue(
      new FrogPublicationError("business", "send", "rejected"),
    );
    await expect(
      publicationService.create(input, "user", audit),
    ).rejects.toMatchObject({ code: "FROG_PUBLICATION_REJECTED" });
    expect(m.updateOrder).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
  });
  it("审计旁路失败不遗留已扣款但未投稿的订单", async () => {
    m.writeAudit.mockRejectedValue(new Error("audit"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await publicationService.create(input, "user", audit);
    expect(m.submit).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
  it("管理员不直接把聚合订单标记失败退款", async () => {
    await expect(
      publicationService.updateOrder(
        "order",
        { status: "failed" },
        "user",
        audit,
      ),
    ).rejects.toMatchObject({ code: "PUBLICATION_ORDER_UPSTREAM_MANAGED" });
    expect(m.updateOrder).not.toHaveBeenCalled();
  });
  it("未知上游订单禁止取消退款", async () => {
    await expect(
      publicationService.cancel("order", input, "user", audit),
    ).rejects.toMatchObject({
      code: "FROG_PUBLICATION_RECONCILIATION_REQUIRED",
    });
    expect(m.cancel).not.toHaveBeenCalled();
  });
  it("终态取消不触发上游副作用", async () => {
    m.findOrder.mockResolvedValue({
      order: { ...order, status: "published", providerOrderId: "upstream" },
      channel,
    });
    await expect(
      publicationService.cancel("order", input, "user", audit),
    ).rejects.toMatchObject({ code: "PUBLICATION_ORDER_STATE_CONFLICT" });
    expect(m.cancel).not.toHaveBeenCalled();
  });
  it("重复取消返回已取消订单", async () => {
    m.findOrder.mockResolvedValue({
      order: { ...order, status: "cancelled" },
      channel,
    });
    expect(
      await publicationService.cancel("order", input, "user", audit),
    ).toMatchObject({ status: "cancelled" });
    expect(m.cancel).not.toHaveBeenCalled();
  });
  it("聚合订单经上游确认后取消并触发本地退款状态", async () => {
    m.findOrder.mockResolvedValue({
      order: { ...order, status: "processing", providerOrderId: "upstream" },
      channel,
    });
    m.cancel.mockResolvedValue(null);
    m.updateOrder.mockResolvedValue({ ...order, status: "cancelled" });

    await expect(
      publicationService.cancel("order", input, "user", audit),
    ).resolves.toMatchObject({ status: "cancelled" });
    expect(m.cancel).toHaveBeenCalledWith("website", "upstream");
    expect(m.updateOrder).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "order", status: "cancelled" }),
    );
  });
  it("已发布聚合订单可提交申诉并记录售后状态", async () => {
    m.findOrder.mockResolvedValue({
      order: {
        ...order,
        status: "published",
        providerOrderId: "upstream",
        providerStatus: 2,
      },
      channel,
    });
    m.appeal.mockResolvedValue(null);
    m.recordProviderSnapshot.mockResolvedValue({
      ...order,
      status: "published",
      providerStatus: 9,
    });

    await expect(
      publicationService.appeal(
        "order",
        { ...input, reason: 1, detail: "未按约定收录" },
        "user",
        audit,
      ),
    ).resolves.toMatchObject({ providerStatus: 9 });
    expect(m.appeal).toHaveBeenCalledWith("website", {
      orderId: "upstream",
      reason: 1,
      detail: "未按约定收录",
    });
    expect(m.recordProviderSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order",
        providerStatus: 9,
      }),
    );
  });
});
