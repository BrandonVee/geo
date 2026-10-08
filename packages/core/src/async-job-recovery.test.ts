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
          hasCreateDispatched: true,
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
        hasCreateDispatched: true,
      }),
    ).toBe("requeue");
  });

  it.each(["queued", "running"] as const)(
    "%s 文章有派发事实就禁止重创，与价格无关",
    (status) => {
      expect(
        decideAsyncJobRecovery({
          kind: "article",
          status,
          queueState: "failed",
          hasCreateDispatched: true,
        }),
      ).toBe("fail_uncertain");
      expect(
        decideAsyncJobRecovery({
          kind: "article",
          status,
          queueState: null,
          hasCreateDispatched: false,
        }),
      ).toBe("requeue");
    },
  );
});
