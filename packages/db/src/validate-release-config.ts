import { databaseEnvSchema } from "@geo/config";

const result = databaseEnvSchema.safeParse(process.env);
if (!result.success) {
  console.error(
    JSON.stringify({
      event: "database-release.configuration-invalid",
      errorCode: "CONFIGURATION_INVALID",
      fields: [
        ...new Set(result.error.issues.map((issue) => issue.path.join("."))),
      ].sort(),
    }),
  );
  process.exit(1);
}

console.info("database-release.configuration-valid");
