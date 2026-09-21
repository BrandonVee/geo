export type QueueJobState =
  | "created"
  | "retry"
  | "active"
  | "completed"
  | "cancelled"
  | "failed";

export type AsyncJobRecoveryAction = "none" | "requeue" | "fail_uncertain";

export function decideAsyncJobRecovery(input: {
  kind: "article" | "report";
  status: "queued" | "running";
  queueState: QueueJobState | null;
  hasExternalId?: boolean;
  hasFeatureCharge?: boolean;
}): AsyncJobRecoveryAction {
  if (
    input.queueState === "created" ||
    input.queueState === "retry" ||
    input.queueState === "active"
  )
    return "none";
  if (input.status === "queued" || input.kind === "report") return "requeue";
  if (input.hasExternalId) return "requeue";
  return input.hasFeatureCharge ? "fail_uncertain" : "requeue";
}
