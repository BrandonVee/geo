import { afterEach, describe, expect, it, vi } from "vitest";
import { FrogPublicationClient, frogPriceToCents } from "./client";

afterEach(() => vi.unstubAllGlobals());

describe("FrogPublicationClient", () => {
  it("以 multipart/form-data 提交媒体订单并隐藏鉴权实现", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 1,
          msg: "投稿成功",
          time: "1",
          data: { order_nid: 123 },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await new FrogPublicationClient(
      "secret-key",
      "https://frog.test",
    ).submit("website", {
      resourceId: "9",
      title: "标题",
      content: "<p>正文</p>",
      thirdId: "local-order",
    });
    expect(result.order_nid).toBe("123");
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.get("api_key")).toBe("secret-key");
    expect(body.get("third_id")).toBe("local-order");
  });

  it("兼容订单详情返回单对象", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 1,
            msg: "ok",
            data: {
              resource_id: "9",
              order_nid: "10",
              status: 2,
              order_url: "https://example.com/article",
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const rows = await new FrogPublicationClient(
      "key",
      "https://frog.test",
    ).orderInfo("website", ["10"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(2);
  });

  it("精确把上游元价格转换为人民币分", () => {
    expect(frogPriceToCents("11.05")).toBe(1105);
    expect(frogPriceToCents("8")).toBe(800);
  });
});
