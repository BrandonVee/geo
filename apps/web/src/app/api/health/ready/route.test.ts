import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  inspectServerEnv: vi.fn(),
  inspectDatabaseReleaseState: vi.fn(),
  query: vi.fn(),
  pingRedis: vi.fn(),
}));

vi.mock("@/server/env", () => ({
  inspectServerEnv: mocks.inspectServerEnv,
}));

vi.mock("@geo/db", () => ({
  pool: { query: mocks.query },
  inspectDatabaseReleaseState: mocks.inspectDatabaseReleaseState,
}));

vi.mock("@/server/redis", () => ({
  pingRedis: mocks.pingRedis,
}));

import { GET } from "./route";

describe("readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inspectServerEnv.mockReturnValue({ success: true });
    mocks.query.mockResolvedValue({ rows: [{ value: 1 }] });
    mocks.pingRedis.mockResolvedValue("PONG");
    mocks.inspectDatabaseReleaseState.mockResolvedValue({
      schemaReady: true,
      seedReady: true,
    });
  });

  it("配置、数据库与 Redis 均正常时返回 ready", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { status: "ready" } });
    expect(mocks.query).toHaveBeenCalledWith("select 1");
    expect(mocks.pingRedis).toHaveBeenCalledOnce();
    expect(mocks.inspectDatabaseReleaseState).toHaveBeenCalledOnce();
  });

  it("配置不完整时拒绝接流且不访问数据库", async () => {
    mocks.inspectServerEnv.mockReturnValue({ success: false });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "CONFIGURATION_INVALID" },
    });
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.inspectDatabaseReleaseState).not.toHaveBeenCalled();
    expect(mocks.pingRedis).not.toHaveBeenCalled();
  });

  it("数据库不可用时返回依赖异常", async () => {
    mocks.query.mockRejectedValue(new Error("database unavailable"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "DEPENDENCY_UNAVAILABLE" },
    });
    expect(mocks.inspectDatabaseReleaseState).not.toHaveBeenCalled();
    expect(mocks.pingRedis).not.toHaveBeenCalled();
  });

  it("Redis 不可用时返回依赖异常", async () => {
    mocks.pingRedis.mockRejectedValue(new Error("redis unavailable"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "DEPENDENCY_UNAVAILABLE", message: "Redis 未就绪" },
    });
    expect(mocks.inspectDatabaseReleaseState).not.toHaveBeenCalled();
  });

  it("迁移表缺失或不可读时返回数据库结构未就绪", async () => {
    mocks.inspectDatabaseReleaseState.mockRejectedValue(
      new Error("relation does not exist"),
    );
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "DATABASE_SCHEMA_NOT_READY" },
    });
  });

  it("数据库结构版本落后时拒绝接流", async () => {
    mocks.inspectDatabaseReleaseState.mockResolvedValue({
      schemaReady: false,
      seedReady: true,
    });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "DATABASE_SCHEMA_NOT_READY" },
    });
  });

  it("基础配置版本落后时拒绝接流", async () => {
    mocks.inspectDatabaseReleaseState.mockResolvedValue({
      schemaReady: true,
      seedReady: false,
    });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "DATABASE_SEED_NOT_READY" },
    });
  });
});
