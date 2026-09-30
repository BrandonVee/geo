export function publicationBodyHtml(
  body: string | undefined,
  format: "text" | "html" | "auto" = "auto",
) {
  if (!body?.trim()) return undefined;
  if (
    format === "html" ||
    (format === "auto" &&
      /<(?:p|div|h[1-6]|br|ul|ol|li|blockquote|strong|em|table|img|a|span)(?:\s[^>]*|\/?)>/i.test(
        body,
      ))
  )
    return body.trim();
  return body
    .trim()
    .split(/\n\s*\n/)
    .map(
      (paragraph) =>
        `<p>${paragraph.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/\n/g, "<br />")}</p>`,
    )
    .join("\n");
}
