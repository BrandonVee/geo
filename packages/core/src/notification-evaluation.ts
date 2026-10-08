export type NotificationSeverity = "warning" | "critical";
export type NotificationMetric = "exposure" | "score" | "avg_rank";

// @project-doc docs/domains/geo_operations.md#notification_workflow
export const notificationMetricPeriod = (
  windowDays: number,
  now = new Date(),
) => {
  const begin = new Date(now);
  begin.setUTCDate(begin.getUTCDate() - windowDays + 1);
  return {
    beginDate: begin.toISOString().slice(0, 10),
    endDate: now.toISOString().slice(0, 10),
  };
};

export type ConnectionFailureClassification =
  | {
      consecutiveFailures: number;
      triggered: false;
      severity: null;
    }
  | {
      consecutiveFailures: number;
      triggered: true;
      severity: NotificationSeverity;
    };

export type MetricAnomalyClassification =
  | {
      anomalous: false;
      direction: "up" | "down";
      severity: null;
    }
  | {
      anomalous: true;
      direction: "up" | "down";
      severity: NotificationSeverity;
    };

const positiveThreshold = (threshold: number) =>
  Math.max(1, Math.trunc(threshold));

/** Number of failures required before a connection alert becomes critical. */
export const connectionFailureCriticalThreshold = (threshold: number) =>
  Math.max(positiveThreshold(threshold) * 2, 5);

/**
 * Number of recent calls needed to distinguish warning from critical state.
 * Reading only the warning threshold makes the critical branch unreachable.
 */
export const connectionFailureLookbackLimit = (threshold: number) =>
  connectionFailureCriticalThreshold(threshold);

/** Counts failures from newest to oldest and stops at the first success. */
export const countConsecutiveFailures = (
  checks: ReadonlyArray<{ status: string }>,
) => {
  const firstSuccess = checks.findIndex((item) => item.status === "success");
  return firstSuccess === -1 ? checks.length : firstSuccess;
};

export const classifyConnectionFailure = (
  consecutiveFailures: number,
  threshold: number,
): ConnectionFailureClassification => {
  const normalizedThreshold = positiveThreshold(threshold);
  const normalizedFailures = Math.max(0, Math.trunc(consecutiveFailures));
  if (normalizedFailures < normalizedThreshold)
    return {
      consecutiveFailures: normalizedFailures,
      triggered: false,
      severity: null,
    };
  return {
    consecutiveFailures: normalizedFailures,
    triggered: true,
    severity:
      normalizedFailures >=
      connectionFailureCriticalThreshold(normalizedThreshold)
        ? "critical"
        : "warning",
  };
};

export const classifyMetricAnomaly = (
  metric: NotificationMetric,
  fluctuation: number,
  threshold: number,
): MetricAnomalyClassification => {
  const normalizedThreshold = positiveThreshold(threshold);
  const direction = metric === "avg_rank" ? "up" : "down";
  const anomalous =
    Number.isFinite(fluctuation) &&
    (metric === "avg_rank"
      ? fluctuation >= normalizedThreshold
      : fluctuation <= -normalizedThreshold);
  if (!anomalous) return { anomalous: false, direction, severity: null };
  return {
    anomalous: true,
    direction,
    severity:
      Math.abs(fluctuation) >= normalizedThreshold * 2 ? "critical" : "warning",
  };
};
