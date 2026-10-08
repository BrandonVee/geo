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
  hasCreateDispatched?: boolean;
}): AsyncJobRecoveryAction {
  if (
    input.queueState === "created" ||
    input.queueState === "retry" ||
    input.queueState === "active"
  )
    return "none";
  if (input.kind === "report") return "requeue";
  if (input.hasExternalId) return "requeue";
  return input.hasCreateDispatched ? "fail_uncertain" : "requeue";
}
