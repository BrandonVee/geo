import { describe, expect, it } from "vitest";
import { validateBrandIconPayload } from "./brand-icon";

const base64 = (value: Uint8Array | string) =>
  Buffer.from(value).toString("base64");

describe("品牌 Logo 文件校验", () => {
  it.each([
    ["image/jpeg", Uint8Array.from([0xff, 0xd8, 0xff, 0xdb])],
    ["image/jpg", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])],
    [
      "image/png",
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ],
    ["image/gif", "GIF89a"],
    ["image/webp", "RIFF\u0000\u0000\u0000\u0000WEBP"],
    ["image/svg+xml", '<?xml version="1.0"?><svg viewBox="0 0 1 1"/>'],
  ])("接受与 %s 签名匹配的内容", (mimeType, content) => {
    expect(validateBrandIconPayload(mimeType, base64(content))).toMatchObject({
      success: true,
    });
  });

  it("拒绝伪造 MIME 的文件", () => {
    expect(validateBrandIconPayload("image/gif", base64("<svg/>"))).toEqual({
      success: false,
      message: "Logo 图片内容与声明的文件格式不匹配",
    });
  });

  it("拒绝非法 Base64", () => {
    expect(validateBrandIconPayload("image/png", "not-base64")).toEqual({
      success: false,
      message: "Logo 图片内容不是有效的 Base64",
    });
  });

  it("按解码后的原始字节限制 2MB", () => {
    const oversized = Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64");
    expect(validateBrandIconPayload("image/png", oversized)).toEqual({
      success: false,
      message: "Logo 原始文件不能超过 2MB",
    });
  });
});
