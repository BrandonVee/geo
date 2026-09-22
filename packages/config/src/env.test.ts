import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { env, webEnvSchema, workerEnv } from "./env";

const base = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://geo:geo@database:5432/geo",
  APP_VERSION: "release-2026.09.17",
  APP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  ANSWERBIT_BASE_URL: "https://answerbit.qq.com",
};

describe("运行环境校验", () => {
  it("解析 Web 配置和可信 Origin", () => {
    const parsed = env({
      ...base,
      APP_URL: "https://geo.example.com",
      BETTER_AUTH_SECRET: "a".repeat(32),
      BETTER_AUTH_URL: "https://geo.example.com",
      BETTER_AUTH_TRUSTED_ORIGINS:
        "https://geo.example.com,https://admin.example.com",
      REDIS_URL: "rediss://cache.example.com:6379/0",
    });
    expect(parsed.APP_VERSION).toBe("release-2026.09.17");
    expect(parsed.BETTER_AUTH_TRUSTED_ORIGINS).toContain(
      "https://admin.example.com",
    );
  });

  it("Worker 不要求认证专用配置", () => {
    expect(workerEnv(base)).toMatchObject({
      DATABASE_URL: base.DATABASE_URL,
      DB_APPLICATION_NAME: "answerbit-geo",
      DB_POOL_MAX: 10,
      DB_POOL_IDLE_TIMEOUT_MS: 30_000,
      DB_POOL_MAX_LIFETIME_SECONDS: 300,
      DB_CONNECT_TIMEOUT_MS: 5_000,
      DB_QUERY_TIMEOUT_MS: 30_000,
      JOB_DB_POOL_MAX: 5,
    });
  });

  it("解析数据库连接池容量与超时", () => {
    expect(
      workerEnv({
        ...base,
        DB_APPLICATION_NAME: "answerbit-geo-worker",
        DB_POOL_MAX: "20",
        DB_POOL_IDLE_TIMEOUT_MS: "45000",
        DB_POOL_MAX_LIFETIME_SECONDS: "900",
        DB_CONNECT_TIMEOUT_MS: "8000",
        DB_QUERY_TIMEOUT_MS: "120000",
        JOB_DB_POOL_MAX: "8",
      }),
    ).toMatchObject({
      DB_APPLICATION_NAME: "answerbit-geo-worker",
      DB_POOL_MAX: 20,
      DB_POOL_IDLE_TIMEOUT_MS: 45_000,
      DB_POOL_MAX_LIFETIME_SECONDS: 900,
      DB_CONNECT_TIMEOUT_MS: 8_000,
      DB_QUERY_TIMEOUT_MS: 120_000,
      JOB_DB_POOL_MAX: 8,
    });
  });

  it("拒绝非 PostgreSQL 数据库地址", () => {
    expect(() =>
      workerEnv({ ...base, DATABASE_URL: "https://database" }),
    ).toThrow(/PostgreSQL/);
  });

  it("拒绝不是 32 字节的加密主密钥", () => {
    expect(() =>
      workerEnv({ ...base, APP_ENCRYPTION_KEY: "not-a-key" }),
    ).toThrow(/base64 encoded 32-byte key/);
  });

  it("拒绝越界连接池配置和非法应用名", () => {
    expect(() => workerEnv({ ...base, DB_POOL_MAX: "0" })).toThrow();
    expect(() =>
      workerEnv({ ...base, DB_APPLICATION_NAME: "geo worker with spaces" }),
    ).toThrow();
  });

  it("拒绝包含路径的可信 Origin", () => {
    const parsed = webEnvSchema.safeParse({
      ...base,
      APP_URL: "https://geo.example.com",
      BETTER_AUTH_SECRET: "a".repeat(32),
      BETTER_AUTH_URL: "https://geo.example.com",
      BETTER_AUTH_TRUSTED_ORIGINS: "https://geo.example.com/path",
      REDIS_URL: "redis://cache:6379/0",
    });
    expect(parsed.success).toBe(false);
  });

  it.each([
    ["带路径的 APP_URL", { APP_URL: "https://geo.example.com/app" }],
    [
      "带查询参数的 BETTER_AUTH_URL",
      { BETTER_AUTH_URL: "https://geo.example.com?tenant=1" },
    ],
    ["带片段的 APP_URL", { APP_URL: "https://geo.example.com#sign-in" }],
    [
      "带凭证的 BETTER_AUTH_URL",
      { BETTER_AUTH_URL: "https://user:password@geo.example.com" },
    ],
    ["非 HTTP 的 APP_URL", { APP_URL: "ftp://geo.example.com" }],
    [
      "非 HTTP 的可信 Origin",
      { BETTER_AUTH_TRUSTED_ORIGINS: "ftp://admin.example.com" },
    ],
  ])("拒绝%s", (_name, override) => {
    const parsed = webEnvSchema.safeParse({
      ...base,
      APP_URL: "https://geo.example.com",
      BETTER_AUTH_SECRET: "a".repeat(32),
      BETTER_AUTH_URL: "https://geo.example.com",
      BETTER_AUTH_TRUSTED_ORIGINS: "https://admin.example.com",
      REDIS_URL: "redis://cache:6379/0",
      ...override,
    });

    expect(parsed.success).toBe(false);
  });

  it("拒绝非 Redis 协议的缓存地址", () => {
    const parsed = webEnvSchema.safeParse({
      ...base,
      APP_URL: "https://geo.example.com",
      BETTER_AUTH_SECRET: "a".repeat(32),
      BETTER_AUTH_URL: "https://geo.example.com",
      REDIS_URL: "https://cache.example.com",
    });
    expect(parsed.success).toBe(false);
  });
});
