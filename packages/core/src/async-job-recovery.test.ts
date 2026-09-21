import { describe, expect, it } from "vitest";
import { decideAsyncJobRecovery } from "./async-job-recovery";

describe("异步任务恢复决策", () => {
  it("队列任务仍在等待、重试或执行时保持现状", () => {
    for (const queueState of ["created", "retry", "active"] as const)
      expect(
        decideAsyncJobRecovery({
          kind: "article",
          status: "running",
          queueState,
          hasFeatureCharge: true,
        }),
      ).toBe("none");
  });

  it("安全重投等待任务、报表任务和已有上游 ID 的文章任务", () => {
    expect(
      decideAsyncJobRecovery({
        kind: "article",
        status: "queued",
        queueState: "failed",
      }),
    ).toBe("requeue");
    expect(
      decideAsyncJobRecovery({
        kind: "report",
        status: "running",
        queueState: null,
      }),
    ).toBe("requeue");
    expect(
      decideAsyncJobRecovery({
        kind: "article",
        status: "running",
        queueState: "failed",
        hasExternalId: true,
        hasFeatureCharge: true,
      }),
    ).toBe("requeue");
  });

  it("已扣费但没有上游 ID 的中断文章任务标记为结果不确定", () => {
    expect(
      decideAsyncJobRecovery({
        kind: "article",
        status: "running",
        queueState: "failed",
        hasFeatureCharge: true,
      }),
    ).toBe("fail_uncertain");
  });
});
