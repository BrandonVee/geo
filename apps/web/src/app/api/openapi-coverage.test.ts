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

const methodPattern = /\b(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g;
const routeMethods = (source: string, path: string) => {
  if (path === "/auth/{...all}") return new Set(["GET", "POST"]);
  return new Set(
    [...source.matchAll(methodPattern)].map((match) => match[1] as string),
  );
};

const documentedOperations = (specification: string) => {
  const operations = new Map<string, Set<string>>();
  let path: string | undefined;
  for (const line of specification.split("\n")) {
    const pathMatch = line.match(/^  (\/[^:]+):$/);
    if (pathMatch) {
      path = pathMatch[1];
      operations.set(path, new Set());
      continue;
    }
    if (/^\S/.test(line)) path = undefined;
    const methodMatch = line.match(/^    (get|post|put|patch|delete):$/);
    if (path && methodMatch)
      operations.get(path)?.add(methodMatch[1].toUpperCase());
  }
  return operations;
};

describe("OpenAPI 路由覆盖", () => {
  it("每个公开 Route 都有契约且每个契约都有实现", async () => {
    const [routeFiles, specification] = await Promise.all([
      listRouteFiles(apiRoot),
      readFile(openApiPath, "utf8"),
    ]);
    const implementedEntries = await Promise.all(
      routeFiles.map(async (file) => {
        const path = routePath(file);
        return [
          path,
          routeMethods(await readFile(file, "utf8"), path),
        ] as const;
      }),
    );
    const implemented = new Map(implementedEntries);
    const documented = documentedOperations(specification);
    const authCatchAll = implemented.has("/auth/{...all}");

    const undocumented = [...implemented.keys()]
      .filter((path) => path !== "/auth/{...all}" && !documented.has(path))
      .sort();
    const missing = [...documented.keys()]
      .filter(
        (path) =>
          !implemented.has(path) &&
          !(path.startsWith("/auth/") && authCatchAll),
      )
      .sort();

    expect(undocumented, "存在未写入 OpenAPI 的 Route").toEqual([]);
    expect(missing, "OpenAPI 中存在没有 Route 实现的路径").toEqual([]);

    const methodMismatches = [...implemented.entries()]
      .filter(([path]) => path !== "/auth/{...all}" && documented.has(path))
      .flatMap(([path, methods]) => {
        const expected = [...(documented.get(path) ?? [])].sort();
        const actual = [...methods].sort();
        return JSON.stringify(actual) === JSON.stringify(expected)
          ? []
          : [{ path, implemented: actual, documented: expected }];
      });
    const authMethods = implemented.get("/auth/{...all}") ?? new Set();
    const unsupportedAuthMethods = [...documented.entries()]
      .filter(([path]) => path.startsWith("/auth/"))
      .flatMap(([path, methods]) =>
        [...methods]
          .filter((method) => !authMethods.has(method))
          .map((method) => ({ path, method })),
      );

    expect(methodMismatches, "Route 与 OpenAPI 的 HTTP 方法不一致").toEqual([]);
    expect(
      unsupportedAuthMethods,
      "认证契约声明了 catch-all Route 不支持的方法",
    ).toEqual([]);
  });
});
