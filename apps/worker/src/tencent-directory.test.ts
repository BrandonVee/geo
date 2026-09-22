import { describe, expect, it, vi } from "vitest";
import {
  queryTencentBrandDirectory,
  TencentDirectoryError,
} from "./tencent-directory";

const input = {
  apiKey: "private-key",
  teamId: "team-1",
  requestId: "request-1",
  baseUrl: "https://answerbit.test",
};

describe("Worker 腾讯企业目录读取", () => {
  it("发送固定 TeamID 和鉴权头并规范化品牌目录", async () => {
    const fetchDirectory = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          data: [
            { id: 1001, brand_name: "旧名称" },
            { id: "1001", brand_name: "新名称" },
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(
      queryTencentBrandDirectory(input, { fetch: fetchDirectory }),
    ).resolves.toEqual([{ id: "1001", name: "新名称" }]);
    expect(fetchDirectory).toHaveBeenCalledOnce();
    const [url, init] = fetchDirectory.mock.calls[0];
    expect(url.toString()).toBe("https://answerbit.test/geo/query/brand");
    expect(init.headers).toMatchObject({
      "X-API-Key": "private-key",
      "X-Request-ID": "request-1",
    });
    expect(JSON.parse(String(init.body))).toEqual({ team_id: "team-1" });
  });

  it.each([
    [401, "unauthorized"],
    [403, "unauthorized"],
    [429, "rate_limited"],
    [400, "business"],
  ] as const)("HTTP %s 不重试并归一化为 %s", async (status, kind) => {
    const fetchDirectory = vi
      .fn()
      .mockResolvedValue(new Response("", { status }));
    const sleep = vi.fn();

    await expect(
      queryTencentBrandDirectory(input, { fetch: fetchDirectory, sleep }),
    ).rejects.toMatchObject({ kind, httpStatus: status });
    expect(fetchDirectory).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("保留腾讯业务错误码且不重试", async () => {
    const fetchDirectory = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 4001, msg: "bad", data: null }), {
        status: 200,
      }),
    );

    await expect(
      queryTencentBrandDirectory(input, { fetch: fetchDirectory }),
    ).rejects.toMatchObject({
      kind: "business",
      httpStatus: 200,
      answerbitCode: 4001,
    } satisfies Partial<TencentDirectoryError>);
    expect(fetchDirectory).toHaveBeenCalledOnce();
  });

  it("拒绝结构不完整的成功响应", async () => {
    const fetchDirectory = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 0, data: [{ id: "brand-1" }] }), {
        status: 200,
      }),
    );

    await expect(
      queryTencentBrandDirectory(input, { fetch: fetchDirectory }),
    ).rejects.toMatchObject({ kind: "invalid_response", httpStatus: 200 });
    expect(fetchDirectory).toHaveBeenCalledOnce();
  });

  it("拒绝超限目录响应且不重试", async () => {
    const fetchDirectory = vi.fn().mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "Content-Length": String(16 * 1024 * 1024 + 1) },
      }),
    );
    const sleep = vi.fn();

    await expect(
      queryTencentBrandDirectory(input, { fetch: fetchDirectory, sleep }),
    ).rejects.toMatchObject({ kind: "invalid_response", httpStatus: 200 });
    expect(fetchDirectory).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("临时 5xx 使用指数退避并在后续成功", async () => {
    const fetchDirectory = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            data: [{ id: "brand-1", brand_name: "品牌" }],
          }),
          { status: 200 },
        ),
      );
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      queryTencentBrandDirectory(input, { fetch: fetchDirectory, sleep }),
    ).resolves.toEqual([{ id: "brand-1", name: "品牌" }]);
    expect(fetchDirectory).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(200);
  });

  it("临时错误最多请求三次后返回稳定错误", async () => {
    const fetchDirectory = vi.fn().mockRejectedValue(new TypeError("network"));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      queryTencentBrandDirectory(input, { fetch: fetchDirectory, sleep }),
    ).rejects.toMatchObject({ kind: "upstream" });
    expect(fetchDirectory).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[200], [400]]);
  });
});
