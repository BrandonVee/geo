import { describe, expect, it } from "vitest";
import {
  classifyRuntimeTaskHealth,
  runtimeTaskBlockedReason,
} from "./runtime-health";

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

describe("周期任务接入前置条件", () => {
  const active = {
    teamId: "team",
    status: "active",
    encryptedApiKey: "ciphertext",
  };
  it("未配置凭证时覆盖旧成功、执行中和未上报状态", () => {
    const dependencies = { answerbit: null, publication: null };
    for (const taskName of [
      "tencent-enterprise-sync",
      "publication-reconciliation",
    ] as const) {
      const reason = runtimeTaskBlockedReason(taskName, dependencies);
      expect(reason).toBeTruthy();
      for (const row of [
        null,
        snapshot,
        { ...snapshot, state: "running" as const },
      ])
        expect(classifyRuntimeTaskHealth(row, now, reason)).toBe("blocked");
    }
    expect(
      runtimeTaskBlockedReason("billing-maintenance", dependencies),
    ).toBeNull();
    expect(
      runtimeTaskBlockedReason("async-job-reconciliation", dependencies),
    ).toBeNull();
  });
  it("失效腾讯凭证立即阻断，即使有历史成功", () => {
    expect(
      runtimeTaskBlockedReason("tencent-enterprise-sync", {
        answerbit: { ...active, status: "invalid" },
        publication: null,
      }),
    ).toBe("ANSWERBIT_KEY_NOT_ACTIVE");
    expect(
      runtimeTaskBlockedReason("tencent-enterprise-sync", {
        answerbit: { ...active, teamId: null },
        publication: null,
      }),
    ).toBe("ANSWERBIT_KEY_NOT_CONFIGURED");
  });
  it("有效配置恢复时间判定，发布兼容 Key 按实际执行规则生效", () => {
    const dependencies = { answerbit: active, publication: active };
    for (const taskName of [
      "tencent-enterprise-sync",
      "publication-reconciliation",
    ] as const)
      expect(
        classifyRuntimeTaskHealth(
          snapshot,
          now,
          runtimeTaskBlockedReason(taskName, dependencies),
        ),
      ).toBe("healthy");
    expect(
      runtimeTaskBlockedReason("publication-reconciliation", {
        answerbit: null,
        publication: null,
        publicationFallbackKey: "legacy-key",
      }),
    ).toBeNull();
    expect(
      runtimeTaskBlockedReason("publication-reconciliation", {
        answerbit: null,
        publication: { ...active, status: "invalid" },
        publicationFallbackKey: "  ",
      }),
    ).toBe("PUBLICATION_KEY_NOT_CONFIGURED");
  });
});
