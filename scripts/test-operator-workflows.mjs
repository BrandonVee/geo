import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const requireDb = createRequire(
  new URL("../packages/db/package.json", import.meta.url),
);
const { Client } = requireDb("pg");
try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (!process.env.MIGRATION_DATABASE_URL)
  throw new Error("MIGRATION_DATABASE_URL_REQUIRED");
const databaseName = `geo_workflow_qa_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = new URL(process.env.MIGRATION_DATABASE_URL);
databaseUrl.pathname = `/${databaseName}`;
const admin = new Client({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
const listen = createServer();
await new Promise((resolve) => listen.listen(0, "127.0.0.1", resolve));
const port = listen.address().port;
await new Promise((resolve) => listen.close(resolve));
const origin = `http://localhost:${port}`;
const env = {
  ...process.env,
  DATABASE_URL: databaseUrl.href,
  DB_POOL_MAX: "5",
  JOB_DB_POOL_MAX: "2",
  MIGRATION_DATABASE_URL: databaseUrl.href,
  APP_URL: origin,
  BETTER_AUTH_URL: origin,
  BETTER_AUTH_TRUSTED_ORIGINS: origin,
  E2E_BASE_URL: origin,
  ANSWERBIT_BASE_URL: origin,
  FROG_PUBLICATION_BASE_URL: origin,
  WORKFLOW_E2E: "1",
  WORKFLOW_DISPOSABLE_DB: "1",
};
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const run = (command, args, extraEnv = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...env, ...extraEnv },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `QA command failed (${code}): ${command} ${args.join(" ")}`,
            ),
          ),
    );
  });
let server,
  created = false;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  await run(process.execPath, ["scripts/release-database.mjs"]);
  await run(process.execPath, ["scripts/release-database.mjs"]);
  await run(
    pnpm,
    [
      "--filter",
      "@geo/web",
      "exec",
      "vitest",
      "run",
      "src/server/repositories/content-documents.integration.test.ts",
    ],
    { CONTENT_DOCUMENT_DB_TESTS: "1" },
  );
  await run(
    pnpm,
    [
      "--filter",
      "@geo/db",
      "exec",
      "vitest",
      "run",
      "src/point-usage.integration.test.ts",
    ],
    { POINT_USAGE_DB_TESTS: "1" },
  );
  await run(
    pnpm,
    [
      "--filter",
      "@geo/db",
      "exec",
      "vitest",
      "run",
      "src/publication-order-page.integration.test.ts",
    ],
    { ORDER_HISTORY_DB_TESTS: "1" },
  );
  await run(
    pnpm,
    [
      "--filter",
      "@geo/web",
      "exec",
      "vitest",
      "run",
      "src/server/services/report-exports.integration.test.ts",
    ],
    { REPORT_EXPORT_DB_TESTS: "1" },
  );
  await run(
    pnpm,
    [
      "--filter",
      "@geo/web",
      "exec",
      "vitest",
      "run",
      "src/server/services/articles.integration.test.ts",
    ],
    { ARTICLE_SUBMISSION_DB_TESTS: "1" },
  );
  await run(
    pnpm,
    [
      "--filter",
      "@geo/web",
      "exec",
      "vitest",
      "run",
      "src/server/services/article-tracking.integration.test.ts",
    ],
    { ARTICLE_TRACKING_DB_TESTS: "1" },
  );
  await run(
    pnpm,
    [
      "--filter",
      "@geo/web",
      "exec",
      "vitest",
      "run",
      "src/server/repositories/members.integration.test.ts",
    ],
    { MEMBER_CAPACITY_DB_TESTS: "1" },
  );
  await run(
    pnpm,
    [
      "--filter",
      "@geo/web",
      "exec",
      "vitest",
      "run",
      "src/server/services/enterprise-lifecycle.integration.test.ts",
    ],
    { ENTERPRISE_LIFECYCLE_DB_TESTS: "1" },
  );
  await run(
    pnpm,
    [
      "--filter",
      "@geo/web",
      "exec",
      "vitest",
      "run",
      "src/server/repositories/organization-directory.integration.test.ts",
    ],
    { ORGANIZATION_DIRECTORY_DB_TESTS: "1" },
  );
  const seed = new Client({ connectionString: databaseUrl.href });
  await seed.connect();
  try {
    await seed.query(
      "INSERT INTO platform_answerbit_credentials (id, team_id, encrypted_api_key, api_key_fingerprint, api_key_hint, status) VALUES (1, 'qa-team', 'unused-qa-credential', 'qa-only', 'qa', 'active')",
    );
  } finally {
    await seed.end();
  }
  await run(pnpm, ["--filter", "@geo/web", "build"]);
  server = spawn(
    pnpm,
    ["--filter", "@geo/web", "exec", "next", "start", "-p", String(port)],
    {
      cwd: root,
      env,
      stdio: "inherit",
      detached: process.platform !== "win32",
    },
  );
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null)
      throw new Error("QA web server exited before readiness");
    try {
      const response = await fetch(`${origin}/api/health/ready`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("QA web server did not become ready");
  await run(pnpm, [
    "exec",
    "playwright",
    "test",
    "e2e/operator-workflows.spec.ts",
    ...process.argv.slice(2),
  ]);
} finally {
  if (server && server.exitCode === null) {
    const stopped = new Promise((resolve) => server.once("exit", resolve));
    if (process.platform === "win32") server.kill();
    else process.kill(-server.pid, "SIGTERM");
    await stopped;
  }
  if (created) {
    await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    console.info("QA disposable database removed");
  }
  await admin.end();
}
