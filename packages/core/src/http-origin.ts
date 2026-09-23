// @project-doc docs/operations/deployment_and_runbook.md#deployment_units
export function isHttpOrigin(value: string): boolean {
  if (value !== value.trim()) return false;
  try {
    const url = new URL(value);
    const separatorIndex = value.indexOf("://");
    if (separatorIndex < 0) return false;
    const authorityStart = separatorIndex + 3;
    const suffixStart = value.slice(authorityStart).search(/[/?#]/);
    const suffix =
      suffixStart < 0 ? "" : value.slice(authorityStart + suffixStart);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.pathname === "/" &&
      (suffix === "" || suffix === "/") &&
      !value.includes("?") &&
      !value.includes("#") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
