import { describe, expect, it } from "vitest";
import { readJsonBody } from "./request-body";

describe("JSON request body", () => {
  it("解析有效 JSON，并将空正文或无效 JSON 交给契约校验", async () => {
    await expect(
      readJsonBody(
        new Request("http://localhost/resource", {
          method: "POST",
          body: JSON.stringify({ name: "value" }),
        }),
      ),
    ).resolves.toEqual({ name: "value" });
    await expect(
      readJsonBody(
        new Request("http://localhost/resource", { method: "POST" }),
      ),
    ).resolves.toBeNull();
    await expect(
      readJsonBody(
        new Request("http://localhost/resource", {
          method: "POST",
          body: "{invalid",
        }),
      ),
    ).resolves.toBeNull();
  });

  it("在读取前拒绝声明长度超限的请求", async () => {
    const result = readJsonBody(
      new Request("http://localhost/resource", {
        method: "POST",
        headers: { "Content-Length": "5" },
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
        headers: { "Content-Length": "2" },
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
      body: '"é"',
    });
    const excessive = new Request("http://localhost/resource", {
      method: "POST",
      body: '"é"',
    });

    await expect(readJsonBody(exact, 4)).resolves.toBe("é");
    await expect(readJsonBody(excessive, 3)).rejects.toMatchObject({
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
    });
  });
});
