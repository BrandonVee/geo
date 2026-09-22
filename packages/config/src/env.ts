import { Buffer } from "node:buffer";
import { z } from "zod";

const databaseUrlSchema = z
  .string()
  .min(1)
  .refine(
    (value) => {
      try {
        return ["postgres:", "postgresql:"].includes(new URL(value).protocol);
      } catch {
        return false;
      }
    },
    { message: "DATABASE_URL must be a PostgreSQL URL" },
  );

const encryptionKeySchema = z.string().refine(
  (value) => {
    try {
      const decoded = Buffer.from(value, "base64");
      return decoded.length === 32 && decoded.toString("base64") === value;
    } catch {
      return false;
    }
  },
  {
    message:
      "APP_ENCRYPTION_KEY must be a canonical base64 encoded 32-byte key",
  },
);

const isHttpOrigin = (value: string) => {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      url.pathname === "/" &&
      !value.includes("?") &&
      !value.includes("#") &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
};

const httpOriginSchema = (name: string, fallback: string) =>
  z
    .url()
    .refine(isHttpOrigin, {
      message: `${name} must be an HTTP(S) origin without path, query, credentials, or fragment`,
    })
    .default(fallback);

const trustedOriginsSchema = z
  .string()
  .default("")
  .superRefine((value, context) => {
    for (const origin of value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)) {
      if (!isHttpOrigin(origin)) {
        context.addIssue({
          code: "custom",
          message: `Invalid trusted origin: ${origin}`,
        });
      }
    }
  });

const boundedInteger = (minimum: number, maximum: number, fallback: number) =>
  z.coerce.number().int().min(minimum).max(maximum).default(fallback);

export const databaseEnvSchema = z.object({
  DATABASE_URL: databaseUrlSchema,
  DB_APPLICATION_NAME: z
    .string()
    .trim()
    .min(1)
    .max(63)
    .regex(/^[A-Za-z0-9._:/-]+$/)
    .default("answerbit-geo"),
  DB_POOL_MAX: boundedInteger(1, 100, 10),
  DB_POOL_IDLE_TIMEOUT_MS: boundedInteger(1_000, 300_000, 30_000),
  DB_POOL_MAX_LIFETIME_SECONDS: boundedInteger(30, 86_400, 300),
  DB_CONNECT_TIMEOUT_MS: boundedInteger(100, 60_000, 5_000),
  DB_QUERY_TIMEOUT_MS: boundedInteger(1_000, 600_000, 30_000),
  JOB_DB_POOL_MAX: boundedInteger(1, 50, 5),
});

const runtimeEnvSchema = databaseEnvSchema.extend({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_VERSION: z.string().trim().min(1).max(128).default("development"),
  APP_ENCRYPTION_KEY: encryptionKeySchema,
  ANSWERBIT_BASE_URL: z
    .url()
    .default("https://answerbit.qq.com")
    .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
      message: "ANSWERBIT_BASE_URL must use HTTP or HTTPS",
    }),
  FROG_PUBLICATION_BASE_URL: z
    .url()
    .default("http://8.138.187.158:8082")
    .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
      message: "FROG_PUBLICATION_BASE_URL must use HTTP or HTTPS",
    }),
  FROG_PUBLICATION_API_KEY: z.string().trim().default(""),
});

export const workerEnvSchema = runtimeEnvSchema;

export const webEnvSchema = runtimeEnvSchema.extend({
  APP_URL: httpOriginSchema("APP_URL", "http://localhost:3000"),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: httpOriginSchema("BETTER_AUTH_URL", "http://localhost:3000"),
  BETTER_AUTH_TRUSTED_ORIGINS: trustedOriginsSchema,
  REDIS_URL: z
    .url()
    .refine(
      (value) => ["redis:", "rediss:"].includes(new URL(value).protocol),
      { message: "REDIS_URL must use redis or rediss protocol" },
    ),
  REDIS_CONNECT_TIMEOUT_MS: boundedInteger(100, 60_000, 5_000),
});

export const envSchema = webEnvSchema;
export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;
export type AppEnv = z.infer<typeof webEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export const databaseEnv = (source: NodeJS.ProcessEnv = process.env) =>
  databaseEnvSchema.parse(source);

export const env = (source: NodeJS.ProcessEnv = process.env) =>
  webEnvSchema.parse(source);

export const workerEnv = (source: NodeJS.ProcessEnv = process.env) =>
  workerEnvSchema.parse(source);
