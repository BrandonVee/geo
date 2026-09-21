import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AnswerBitClient } from "./client";
import { AnswerBitError } from "./errors";
afterEach(() => vi.unstubAllGlobals());
describe("AnswerBitClient", () => {
  it("解析业务响应并发送鉴权头", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ code: 0, msg: "success", data: { value: 7 } }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const result = await new AnswerBitClient(
      "private-key",
      "https://answerbit.test",
    ).post(
      "/geo/query/brand",
      {},
      z.object({ value: z.number() }),
      "request-id",
    );
    expect(result.value).toBe(7);
    expect(fetchMock.mock.calls[0][1].headers["X-API-Key"]).toBe("private-key");
  });
  it("将业务错误归一化", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 4001, msg: "bad", data: null }), {
          status: 200,
        }),
      ),
    );
    await expect(
      new AnswerBitClient("key", "https://answerbit.test").post(
        "/geo/query/brand",
        {},
        z.unknown(),
        "request-id",
      ),
    ).rejects.toMatchObject({
      kind: "business",
      businessCode: 4001,
    } satisfies Partial<AnswerBitError>);
  });
  it("网络 5xx 查询按配置重试", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, data: [] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await new AnswerBitClient("key", "https://answerbit.test").post(
      "/geo/query/brand",
      {},
      z.array(z.unknown()),
      "request-id",
      { retries: 1 },
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("仅在调用方显式开启时按 Retry-After 重试 429", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("", { status: 429, headers: { "retry-after": "0" } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, data: [] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await new AnswerBitClient("key", "https://answerbit.test").post(
      "/geo/query/brand",
      {},
      z.array(z.unknown()),
      "request-id",
      { retries: 1, retryRateLimited: true },
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("外部写入可只重试明确拒绝的 429 而不重放 5xx", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      new AnswerBitClient("key", "https://answerbit.test").post(
        "/geo/billing/quota/purchase",
        {},
        z.unknown(),
        "request-id",
        {
          retries: 2,
          retryRateLimited: true,
          retryTransient: false,
        },
      ),
    ).rejects.toMatchObject({ kind: "upstream" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
