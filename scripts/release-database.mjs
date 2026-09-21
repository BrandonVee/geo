import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const databasePackage = fileURLToPath(
  new URL("../packages/db", import.meta.url),
);
const packageBinary = (name) =>
  fileURLToPath(
    new URL(
      `../packages/db/node_modules/.bin/${name}${process.platform === "win32" ? ".cmd" : ""}`,
      import.meta.url,
    ),
  );
const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL;

if (!migrationDatabaseUrl) {
  console.error("database-release.configuration-invalid", {
    code: "MIGRATION_DATABASE_URL_REQUIRED",
  });
  process.exit(1);
}

let parsedUrl;
try {
  parsedUrl = new URL(migrationDatabaseUrl);
} catch {
  console.error("database-release.configuration-invalid", {
    code: "MIGRATION_DATABASE_URL_INVALID",
  });
  process.exit(1);
}
if (!new Set(["postgres:", "postgresql:"]).has(parsedUrl.protocol)) {
  console.error("database-release.configuration-invalid", {
    code: "MIGRATION_DATABASE_URL_INVALID",
  });
  process.exit(1);
}

const childEnvironment = { ...process.env, DATABASE_URL: migrationDatabaseUrl };
delete childEnvironment.MIGRATION_DATABASE_URL;

const steps = [
  {
    name: "validate",
    command: packageBinary("tsx"),
    args: ["src/validate-release-config.ts"],
  },
  { name: "migrate", command: packageBinary("drizzle-kit"), args: ["migrate"] },
  {
    name: "record-schema-version",
    command: packageBinary("tsx"),
    args: ["src/record-schema-version.ts"],
  },
  { name: "seed", command: packageBinary("tsx"), args: ["src/seed.ts"] },
  {
    name: "rls-check",
    command: packageBinary("tsx"),
    args: ["src/check-rls.ts"],
  },
];

for (const step of steps) {
  console.info("database-release.step-started", { step: step.name });
  const result = await new Promise((resolve, reject) => {
    const child = spawn(step.command, step.args, {
      cwd: databasePackage,
      env: childEnvironment,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  if (result.signal) {
    console.error("database-release.step-interrupted", {
      step: step.name,
      signal: result.signal,
    });
    process.kill(process.pid, result.signal);
    break;
  }
  if (result.code !== 0) {
    console.error("database-release.step-failed", {
      step: step.name,
      code: result.code,
    });
    process.exit(result.code ?? 1);
  }
  console.info("database-release.step-succeeded", { step: step.name });
}

console.info("database-release.succeeded", {
  steps: steps.map((step) => step.name),
});
