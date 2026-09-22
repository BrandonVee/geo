import { describe, expect, it, vi } from "vitest";
import {
  BoundedJsonResponseError,
  discardResponseBody,
  readBoundedJsonResponse,
} from "./bounded-json-response";

describe("bounded upstream JSON responses", () => {
  it("解析上限内的 UTF-8 JSON", async () => {
    await expect(
      readBoundedJsonResponse(
        new Response(JSON.stringify({ status: "ok" })),
        32,
      ),
    ).resolves.toEqual({ status: "ok" });
  });

  it("在读取前拒绝声明长度超限的响应", async () => {
    const result = readBoundedJsonResponse(
      new Response("{}", { headers: { "Content-Length": "5" } }),
      4,
    );

    await expect(result).rejects.toMatchObject({
      kind: "BODY_TOO_LARGE",
    } satisfies Partial<BoundedJsonResponseError>);
  });

  it("不信任 Content-Length，并限制流式接收的实际字节数", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"data":'));
        controller.enqueue(new TextEncoder().encode('"oversized"}'));
        controller.close();
      },
    });
    const result = readBoundedJsonResponse(
      new Response(body, { headers: { "Content-Length": "2" } }),
      12,
    );

    await expect(result).rejects.toMatchObject({
      kind: "BODY_TOO_LARGE",
    } satisfies Partial<BoundedJsonResponseError>);
  });

  it.each([
    ["语法错误", new TextEncoder().encode("{invalid")],
    ["非 UTF-8", new Uint8Array([0xff])],
  ])("将%s归一化为无原文的稳定错误", async (_name, bytes) => {
    await expect(
      readBoundedJsonResponse(new Response(bytes)),
    ).rejects.toMatchObject({
      kind: "INVALID_JSON",
      message: "UPSTREAM_INVALID_JSON",
    } satisfies Partial<BoundedJsonResponseError>);
  });

  it("主动取消无需解析的响应正文", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }));

    await discardResponseBody(response);

    expect(cancel).toHaveBeenCalledOnce();
    expect(response.bodyUsed).toBe(true);
  });
});
