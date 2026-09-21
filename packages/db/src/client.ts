import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { createRuntimeDatabasePoolConfig } from "./pool-config";

export const pool = new Pool(createRuntimeDatabasePoolConfig());
pool.on("error", (error) => {
  const errorCode =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "DATABASE_IDLE_CLIENT_ERROR";
  console.error(
    JSON.stringify({
      event: "database.pool-error",
      errorCode,
    }),
  );
});
export const db = drizzle(pool, { schema });
