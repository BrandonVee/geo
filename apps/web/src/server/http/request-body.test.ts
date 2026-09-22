import { describe, expect, it } from "vitest";
import { readJsonBody, withBoundedRequestBody } from "./request-body";

describe("JSON request body", () => {
  it("解析有效 JSON，并将空正文交给契约校验", async () => {
    await expect(
      readJsonBody(
        new Request("http://localhost/resource", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "value" }),
        }),
      ),
    ).resolves.toEqual({ name: "value" });
    await expect(
      readJsonBody(
        new Request("http://localhost/resource", { method: "POST" }),
      ),
    ).resolves.toBeNull();
  });

  it("以稳定错误拒绝语法错误或非 UTF-8 的 JSON", async () => {
    const malformed = readJsonBody(
      new Request("http://localhost/resource", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{invalid",
      }),
    );
    const invalidUtf8 = readJsonBody(
      new Request("http://localhost/resource", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: new Uint8Array([0xff]),
      }),
    );

    await expect(malformed).rejects.toMatchObject({
      status: 400,
      code: "INVALID_JSON",
    });
    await expect(invalidUtf8).rejects.toMatchObject({
      status: 400,
      code: "INVALID_JSON",
    });
  });

  it("接受标准 JSON、UTF-8 参数和结构化 JSON 媒体类型", async () => {
    for (const contentType of [
      "application/json",
      "application/json; charset=UTF-8",
      'application/vnd.api+json; charset="utf-8"',
    ]) {
      await expect(
        readJsonBody(
          new Request("http://localhost/resource", {
            method: "POST",
            headers: { "Content-Type": contentType },
            body: "{}",
          }),
        ),
      ).resolves.toEqual({});
    }
  });

  it.each([
    ["缺少 Content-Type", undefined],
    ["非 JSON 媒体类型", "text/plain"],
    ["非 UTF-8 JSON", "application/json; charset=iso-8859-1"],
    ["伪造 JSON 后缀", "text/vnd.api+json"],
  ])("拒绝%s", async (_name, contentType) => {
    const headers = contentType ? { "Content-Type": contentType } : undefined;
    await expect(
      readJsonBody(
        new Request("http://localhost/resource", {
          method: "POST",
          headers,
          body: "{}",
        }),
      ),
    ).rejects.toMatchObject({
      status: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
    });
  });

  it("在读取前拒绝声明长度超限的请求", async () => {
    const result = readJsonBody(
      new Request("http://localhost/resource", {
        method: "POST",
        headers: {
          "Content-Length": "5",
          "Content-Type": "application/json",
        },
        body: "{}",
      }),
      4,
    );

    await expect(result).rejects.toMatchObject({
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
    });
  });

  it("不信任 Content-Length，并限制流式接收的实际字节数", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"a":'));
        controller.enqueue(encoder.encode("12345}"));
        controller.close();
      },
    });
    const result = readJsonBody(
      new Request("http://localhost/resource", {
        method: "POST",
        headers: {
          "Content-Length": "2",
          "Content-Type": "application/json",
        },
        body,
        duplex: "half",
      } as RequestInit & { duplex: "half" }),
      8,
    );

    await expect(result).rejects.toMatchObject({
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
    });
  });

  it("按 UTF-8 字节而不是字符数执行上限", async () => {
    const exact = new Request("http://localhost/resource", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '"é"',
    });
    const excessive = new Request("http://localhost/resource", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '"é"',
    });

    await expect(readJsonBody(exact, 4)).resolves.toBe("é");
    await expect(readJsonBody(excessive, 3)).rejects.toMatchObject({
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
    });
  });
});

describe("bounded request body", () => {
  it("保留认证适配器需要的请求信息并重新公开正文", async () => {
    const request = new Request("https://geo.test/api/auth/sign-in/username", {
      method: "POST",
      headers: {
        "Content-Length": "1",
        "Content-Type": "application/octet-stream",
        "X-Test": "preserved",
      },
      body: new Uint8Array([0, 1, 2, 255]),
    });

    const forwarded = await withBoundedRequestBody(request, 4);

    expect(forwarded).not.toBe(request);
    expect(forwarded.url).toBe(request.url);
    expect(forwarded.method).toBe("POST");
    expect(forwarded.headers.get("Content-Type")).toBe(
      "application/octet-stream",
    );
    expect(forwarded.headers.get("X-Test")).toBe("preserved");
    expect(forwarded.headers.get("Content-Length")).toBe("4");
    expect(new Uint8Array(await forwarded.arrayBuffer())).toEqual(
      new Uint8Array([0, 1, 2, 255]),
    );
  });

  it("限制任意媒体类型正文的实际接收字节数", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4, 5]));
        controller.close();
      },
    });
    const result = withBoundedRequestBody(
      new Request("https://geo.test/api/auth/sign-in/username", {
        method: "POST",
        headers: {
          "Content-Length": "2",
          "Content-Type": "application/octet-stream",
        },
        body,
        duplex: "half",
      } as RequestInit & { duplex: "half" }),
      4,
    );

    await expect(result).rejects.toMatchObject({
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
    });
  });

  it("没有正文时复用原请求", async () => {
    const request = new Request("https://geo.test/api/auth/session");
    await expect(withBoundedRequestBody(request)).resolves.toBe(request);
  });
});
