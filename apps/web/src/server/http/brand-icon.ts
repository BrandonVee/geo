const MAX_BRAND_ICON_BYTES = 2 * 1024 * 1024;

const canonicalBase64Pattern =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const startsWith = (value: Uint8Array, signature: number[]) =>
  signature.every((byte, index) => value[index] === byte);

const isSvg = (value: Uint8Array) => {
  const prefix = Buffer.from(value.subarray(0, 8_192))
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .trimStart()
    .replace(/^<\?xml[^>]*>\s*/i, "")
    .replace(/^(?:<!--[^]*?-->\s*)+/i, "");
  return /^<svg(?:\s|>)/i.test(prefix);
};

const matchesMimeType = (value: Uint8Array, mimeType: string) => {
  switch (mimeType) {
    case "image/jpeg":
    case "image/jpg":
      return startsWith(value, [0xff, 0xd8, 0xff]);
    case "image/png":
      return startsWith(
        value,
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      );
    case "image/gif":
      return ["GIF87a", "GIF89a"].includes(
        Buffer.from(value.subarray(0, 6)).toString("ascii"),
      );
    case "image/webp":
      return (
        Buffer.from(value.subarray(0, 4)).toString("ascii") === "RIFF" &&
        Buffer.from(value.subarray(8, 12)).toString("ascii") === "WEBP"
      );
    case "image/svg+xml":
      return isSvg(value);
    default:
      return false;
  }
};

export type BrandIconValidationResult =
  | { success: true; byteLength: number }
  | { success: false; message: string };

export function validateBrandIconPayload(
  iconMimeType: string,
  iconData: string,
): BrandIconValidationResult {
  const compact = iconData.replace(/\s/g, "");
  if (!compact || !canonicalBase64Pattern.test(compact))
    return { success: false, message: "Logo 图片内容不是有效的 Base64" };

  const content = Buffer.from(compact, "base64");
  if (!content.length) return { success: false, message: "Logo 图片内容为空" };
  if (content.byteLength > MAX_BRAND_ICON_BYTES)
    return { success: false, message: "Logo 原始文件不能超过 2MB" };
  if (!matchesMimeType(content, iconMimeType))
    return {
      success: false,
      message: "Logo 图片内容与声明的文件格式不匹配",
    };

  return { success: true, byteLength: content.byteLength };
}
