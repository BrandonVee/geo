import { describe, expect, it } from "vitest";
import { classifyRuntimeTaskHealth } from "./runtime-health";

const now = new Date("2026-09-17T08:00:00.000Z").getTime();
const snapshot = {
  state: "succeeded" as const,
  expectedIntervalSeconds: 300,
  timeoutSeconds: 240,
  lastStartedAt: "2026-09-17T07:59:00.000Z",
  lastSucceededAt: "2026-09-17T07:59:30.000Z",
};

describe("后台周期任务健康分类", () => {
  it("区分缺失、成功和失败任务", () => {
    expect(classifyRuntimeTaskHealth(null, now)).toBe("missing");
    expect(classifyRuntimeTaskHealth(snapshot, now)).toBe("healthy");
    expect(
      classifyRuntimeTaskHealth({ ...snapshot, state: "failed" }, now),
    ).toBe("failed");
  });

  it("运行任务超过超时阈值后标记为过期", () => {
    expect(
      classifyRuntimeTaskHealth(
        {
          ...snapshot,
          state: "running",
          lastStartedAt: "2026-09-17T07:57:00.000Z",
        },
        now,
      ),
    ).toBe("running");
    expect(
      classifyRuntimeTaskHealth(
        {
          ...snapshot,
          state: "running",
          lastStartedAt: "2026-09-17T07:55:59.000Z",
        },
        now,
      ),
    ).toBe("stale");
  });

  it("成功任务超过两个调度周期未推进后标记为过期", () => {
    expect(
      classifyRuntimeTaskHealth(
        {
          ...snapshot,
          lastSucceededAt: "2026-09-17T07:49:59.000Z",
        },
        now,
      ),
    ).toBe("stale");
  });
});
