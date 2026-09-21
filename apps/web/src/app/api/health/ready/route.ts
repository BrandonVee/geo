import { NextResponse } from "next/server";
import { inspectDatabaseReleaseState, pool } from "@geo/db";
import { inspectServerEnv } from "@/server/env";
import { pingRedis } from "@/server/redis";
export async function GET() {
  const requestId = crypto.randomUUID();
  if (!inspectServerEnv().success)
    return NextResponse.json(
      {
        error: {
          code: "CONFIGURATION_INVALID",
          message: "服务配置未就绪",
        },
        requestId,
      },
      { status: 503 },
    );
  try {
    if (!pool) throw new Error("DATABASE_URL is not configured");
    await pool.query("select 1");
  } catch {
    return NextResponse.json(
      {
        error: { code: "DEPENDENCY_UNAVAILABLE", message: "数据库未就绪" },
        requestId,
      },
      { status: 503 },
    );
  }
  try {
    await pingRedis();
  } catch {
    return NextResponse.json(
      {
        error: { code: "DEPENDENCY_UNAVAILABLE", message: "Redis 未就绪" },
        requestId,
      },
      { status: 503 },
    );
  }
  let releaseState;
  try {
    releaseState = await inspectDatabaseReleaseState();
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "DATABASE_SCHEMA_NOT_READY",
          message: "数据库结构尚未完成发布",
        },
        requestId,
      },
      { status: 503 },
    );
  }
  if (!releaseState.schemaReady)
    return NextResponse.json(
      {
        error: {
          code: "DATABASE_SCHEMA_NOT_READY",
          message: "数据库结构版本与应用不一致",
        },
        requestId,
      },
      { status: 503 },
    );
  if (!releaseState.seedReady)
    return NextResponse.json(
      {
        error: {
          code: "DATABASE_SEED_NOT_READY",
          message: "数据库基础配置尚未完成发布",
        },
        requestId,
      },
      { status: 503 },
    );
  return NextResponse.json({ data: { status: "ready" }, requestId });
}
