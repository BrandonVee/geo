import { afterEach, describe, expect, it, vi } from "vitest";
import { FrogPublicationClient, frogPriceToCents } from "./client";

afterEach(() => vi.unstubAllGlobals());

describe("FrogPublicationClient", () => {
  it.each([
    "https://frog.test/api",
    "https://frog.test?tenant=1",
    "https://user:pass@frog.test",
  ])("拒绝非 Origin 基础地址 %s", (baseUrl) => {
    expect(() => new FrogPublicationClient("key", baseUrl)).toThrow(
      "FROG_PUBLICATION_BASE_URL_INVALID",
    );
  });

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

  it("读取媒体筛选分类并传入媒体类型", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 1,
          msg: "获取成功",
          data: [
            {
              field_id: "1006",
              field_type: "field_1",
              field_title: "新闻资讯",
              rsort: 6,
            },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const rows = await new FrogPublicationClient(
      "key",
      "https://frog.test",
    ).listMediaFields("website", "field_1");
    expect(rows).toEqual([
      expect.objectContaining({ field_id: "1006", field_title: "新闻资讯" }),
    ]);
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.get("media_type")).toBe("website");
    expect(body.get("field_type")).toBe("field_1");
  });

  it("兼容生产环境返回的 field_10 与 field_11 分类", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 1,
            msg: "获取成功",
            data: [
              {
                field_id: "10001",
                field_type: "field_10",
                field_title: "扩展分类",
                rsort: 1,
              },
              {
                field_id: "11001",
                field_type: "field_11",
                field_title: "扩展属性",
                rsort: 2,
              },
            ],
          }),
        ),
      ),
    );

    await expect(
      new FrogPublicationClient("key", "https://frog.test").listMediaFields(
        "website",
      ),
    ).resolves.toHaveLength(2);
  });

  it("查询小青蛙账户的发布余额和接口算力", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 1,
          msg: "获取成功",
          data: { power_count: 81, money: 12.35 },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const balance = await new FrogPublicationClient(
      "key",
      "https://frog.test",
    ).getBalance();
    expect(balance).toEqual({ power_count: 81, money: "12.35" });
    expect(fetchMock.mock.calls[0][0].toString()).toBe(
      "https://frog.test/api/geo/get_balance",
    );
  });

  it("精确把上游元价格转换为人民币分", () => {
    expect(frogPriceToCents("11.05")).toBe(1105);
    expect(frogPriceToCents("8")).toBe(800);
  });
  it("禁止重定向并屏蔽上游拒绝正文中的密钥", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ code: 0, msg: "secret-key: raw body", data: null }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      new FrogPublicationClient("secret-key", "https://frog.test").cancel(
        "website",
        "10",
      ),
    ).rejects.toMatchObject({
      kind: "business",
      message: "聚合发布上游拒绝请求",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].redirect).toBe("error");
  });
  it("取消非成功 HTTP 响应正文并返回稳定错误", async () => {
    const response = new Response("secret upstream body", { status: 502 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    await expect(
      new FrogPublicationClient("key", "https://frog.test").getBalance(),
    ).rejects.toMatchObject({
      kind: "upstream",
      message: "聚合发布上游返回 HTTP 502",
      status: 502,
    });
    expect(response.bodyUsed).toBe(true);
  });
  it.each(["javascript:alert(1)", "data:text/html,hello"])(
    "拒绝非 HTTP 结果链接 %s",
    async (url) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              code: 1,
              data: {
                order_nid: "10",
                resource_id: "9",
                status: 2,
                order_url: url,
              },
            }),
          ),
        ),
      );
      await expect(
        new FrogPublicationClient("key", "https://frog.test").orderInfo(
          "website",
          ["10"],
        ),
      ).rejects.toMatchObject({ kind: "invalid_response" });
    },
  );
  it("拒绝失去精度的数值订单号并保留字符串长订单号", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Response(
            JSON.stringify({
              code: 1,
              data: { order_nid: Number.MAX_SAFE_INTEGER + 1 },
            }),
          ),
      )
      .mockImplementationOnce(
        () =>
          new Response(
            JSON.stringify({
              code: 1,
              data: { order_nid: "99999999999999999999" },
            }),
          ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = new FrogPublicationClient("key", "https://frog.test");
    const input = {
      resourceId: "9",
      title: "标题",
      content: "<p>正文</p>",
      thirdId: "local",
    };
    await expect(client.submit("website", input)).rejects.toMatchObject({
      kind: "invalid_response",
    });
    expect(await client.submit("website", input)).toEqual({
      order_nid: "99999999999999999999",
    });
  });
  it("接受零元数字价格与字符串资源 ID，拒绝超出本地价格范围", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 1,
            data: [
              {
                resource_id: "99999999999999999999",
                title: "免费",
                status: 1,
                price: 0,
              },
            ],
          }),
        ),
      ),
    );
    expect(
      await new FrogPublicationClient("key", "https://frog.test").listMedia(
        "website",
      ),
    ).toMatchObject([{ resource_id: "99999999999999999999", price: "0" }]);
    expect(frogPriceToCents("0")).toBe(0);
    expect(() => frogPriceToCents("10000000.01")).toThrow(
      "聚合发布价格超出范围",
    );
  });

  it("将超限响应归一化为格式错误且不泄露正文", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("secret upstream body", {
          headers: { "Content-Length": String(16 * 1024 * 1024 + 1) },
        }),
      ),
    );

    await expect(
      new FrogPublicationClient("key", "https://frog.test").getBalance(),
    ).rejects.toMatchObject({
      kind: "invalid_response",
      message: "聚合发布上游响应格式无效",
      status: 200,
    });
  });
});
