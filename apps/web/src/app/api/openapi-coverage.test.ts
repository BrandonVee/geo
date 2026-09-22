import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const apiRoot = dirname(fileURLToPath(import.meta.url));
const openApiPath = resolve(
  apiRoot,
  "../../../../../docs/interfaces/openapi.yaml",
);

async function listRouteFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return listRouteFiles(path);
      return entry.isFile() && entry.name === "route.ts" ? [path] : [];
    }),
  );
  return nested.flat();
}

const routePath = (file: string) =>
  `/${relative(apiRoot, dirname(file))
    .split(sep)
    .map((segment) =>
      segment
        .replace(/^\[\.\.\.([^\]]+)\]$/, "{...$1}")
        .replace(/^\[([^\]]+)\]$/, "{$1}"),
    )
    .join("/")}`;

describe("OpenAPI 路由覆盖", () => {
  it("每个公开 Route 都有契约且每个契约都有实现", async () => {
    const [routeFiles, specification] = await Promise.all([
      listRouteFiles(apiRoot),
      readFile(openApiPath, "utf8"),
    ]);
    const implemented = new Set(routeFiles.map(routePath));
    const documented = new Set(
      [...specification.matchAll(/^  (\/[^:]+):$/gm)].map((match) => match[1]),
    );
    const authCatchAll = implemented.has("/auth/{...all}");

    const undocumented = [...implemented]
      .filter((path) => path !== "/auth/{...all}" && !documented.has(path))
      .sort();
    const missing = [...documented]
      .filter(
        (path) =>
          !implemented.has(path) &&
          !(path.startsWith("/auth/") && authCatchAll),
      )
      .sort();

    expect(undocumented, "存在未写入 OpenAPI 的 Route").toEqual([]);
    expect(missing, "OpenAPI 中存在没有 Route 实现的路径").toEqual([]);
  });
});
