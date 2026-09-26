export const runtimeTaskDefinitions = {
  "publication-reconciliation": {
    label: "聚合发布履约同步",
    expectedIntervalSeconds: 5 * 60,
    timeoutSeconds: 4 * 60,
  },
  "billing-maintenance": {
    label: "计费维护",
    expectedIntervalSeconds: 5 * 60,
    timeoutSeconds: 5 * 60,
  },
  "async-job-reconciliation": {
    label: "异步任务恢复",
    expectedIntervalSeconds: 5 * 60,
    timeoutSeconds: 4 * 60,
  },
  "notification-evaluation": {
    label: "持续检测",
    expectedIntervalSeconds: 15 * 60,
    timeoutSeconds: 10 * 60,
  },
  "tencent-enterprise-sync": {
    label: "腾讯企业同步",
    expectedIntervalSeconds: 24 * 60 * 60,
    timeoutSeconds: 4 * 60,
  },
} as const;

export type RuntimeTaskName = keyof typeof runtimeTaskDefinitions;
export type RuntimeTaskState = "running" | "succeeded" | "failed";
export type RuntimeTaskHealth =
  | "healthy"
  | "running"
  | "failed"
  | "stale"
  | "missing";

type RuntimeTaskSnapshot = {
  state: RuntimeTaskState;
  expectedIntervalSeconds: number;
  timeoutSeconds: number;
  lastStartedAt: Date | string;
  lastSucceededAt: Date | string | null;
};

const timestamp = (value: Date | string) =>
  value instanceof Date ? value.getTime() : new Date(value).getTime();

export function classifyRuntimeTaskHealth(
  snapshot: RuntimeTaskSnapshot | null | undefined,
  now = Date.now(),
): RuntimeTaskHealth {
  if (!snapshot) return "missing";
  if (snapshot.state === "failed") return "failed";

  if (snapshot.state === "running") {
    const startedAt = timestamp(snapshot.lastStartedAt);
    return Number.isFinite(startedAt) &&
      now - startedAt <= snapshot.timeoutSeconds * 1_000
      ? "running"
      : "stale";
  }

  if (!snapshot.lastSucceededAt) return "stale";
  const succeededAt = timestamp(snapshot.lastSucceededAt);
  return Number.isFinite(succeededAt) &&
    now - succeededAt <= snapshot.expectedIntervalSeconds * 2_000
    ? "healthy"
    : "stale";
}
