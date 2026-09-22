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

const documentedOperationBlocks = (specification: string) => {
  const operations: { path: string; method: string; source: string }[] = [];
  let path: string | undefined;
  let operation: Omit<(typeof operations)[number], "source"> | undefined;
  let source: string[] = [];
  const finishOperation = () => {
    if (operation) operations.push({ ...operation, source: source.join("\n") });
    operation = undefined;
    source = [];
  };

  for (const line of specification.split("\n")) {
    const pathMatch = line.match(/^  (\/[^:]+):$/);
    if (pathMatch) {
      finishOperation();
      path = pathMatch[1];
      continue;
    }
    const methodMatch = line.match(/^    (get|post|put|patch|delete):$/);
    if (methodMatch && path) {
      finishOperation();
      operation = { path, method: methodMatch[1].toUpperCase() };
      continue;
    }
    if (operation) source.push(line);
  }
  finishOperation();
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

  it("每个限流响应都声明标准 Retry-After 响应头", async () => {
    const specification = await readFile(openApiPath, "utf8");
    const rateLimitResponses = [
      ...specification.matchAll(/^ {8}"429":\n((?: {10,}.*\n)*)/gm),
    ];

    expect(rateLimitResponses.length).toBeGreaterThan(0);
    expect(
      rateLimitResponses.filter(
        ([, block]) =>
          !block.includes('$ref: "#/components/headers/RetryAfter"'),
      ),
      "存在没有声明 Retry-After 的 429 响应",
    ).toEqual([]);
  });

  it("自有 API Route 统一使用可关联 requestId 的响应边界", async () => {
    const routeFiles = await listRouteFiles(apiRoot);
    const sources = await Promise.all(
      routeFiles.map(async (file) => ({
        file: relative(apiRoot, file),
        source: await readFile(file, "utf8"),
      })),
    );

    expect(
      sources
        .filter(({ source }) => source.includes("Response.json("))
        .map(({ file }) => file),
      "Route 绕过了统一 JSON 响应边界",
    ).toEqual([]);
    expect(
      sources
        .filter(({ source }) => source.includes("new Response(null"))
        .map(({ file }) => file),
      "空响应未携带 requestId 响应头",
    ).toEqual([]);
    expect(
      sources
        .filter(
          ({ source }) =>
            source.includes("new Response(") &&
            !source.toLowerCase().includes('"x-request-id"'),
        )
        .map(({ file }) => file),
      "自定义响应未显式携带 requestId 响应头",
    ).toEqual([]);
  });

  it("自有 JSON 请求统一使用有限解析器并声明 413 响应", async () => {
    const [routeFiles, specification] = await Promise.all([
      listRouteFiles(apiRoot),
      readFile(openApiPath, "utf8"),
    ]);
    const sources = await Promise.all(
      routeFiles.map(async (file) => ({
        file: relative(apiRoot, file),
        source: await readFile(file, "utf8"),
      })),
    );

    expect(
      sources
        .filter(
          ({ file, source }) =>
            file.startsWith("v1/") && source.includes("request.json("),
        )
        .map(({ file }) => file),
      "Route 绕过了 4 MiB JSON 请求体上限",
    ).toEqual([]);

    expect(
      documentedOperationBlocks(specification)
        .filter(
          ({ path, source }) =>
            path.startsWith("/v1/") &&
            source.includes("      requestBody:") &&
            !source.includes(
              '        "413":\n          $ref: "#/components/responses/PayloadTooLarge"',
            ),
        )
        .map(({ method, path }) => `${method} ${path}`),
      "JSON 请求契约缺少 PAYLOAD_TOO_LARGE 响应",
    ).toEqual([]);
  });

  it("每个业务写入 Route 都经过可信浏览器来源校验", async () => {
    const routeFiles = await listRouteFiles(apiRoot);
    const missingOriginChecks = (
      await Promise.all(
        routeFiles
          .filter((file) => relative(apiRoot, file).startsWith("v1/"))
          .map(async (file) => {
            const source = await readFile(file, "utf8");
            return [
              ...source.matchAll(
                /export async function (POST|PUT|PATCH|DELETE)\b([\s\S]*?)(?=\nexport async function |$)/g,
              ),
            ]
              .filter(
                ([, , handler]) =>
                  !handler.includes("requireUser(request") &&
                  !handler.includes("assertTrustedWriteOrigin(request"),
              )
              .map(
                ([, method]) =>
                  `${method} /${relative(apiRoot, file).replace(/\/route\.ts$/, "")}`,
              );
          }),
      )
    ).flat();

    expect(missingOriginChecks, "业务写入绕过了可信 Origin 校验").toEqual([]);
  });
});
