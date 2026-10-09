import { stableErrorCode, type RuntimeTaskName } from "@geo/core";

export function runtimeTaskErrorCode(
  taskName: RuntimeTaskName,
  error: unknown,
) {
  return stableErrorCode(
    error,
    `${taskName.replaceAll("-", "_").toUpperCase()}_FAILED`,
  );
}

export function skippedRuntimeTaskErrorCode(
  taskName: RuntimeTaskName,
  result: unknown,
): string | null {
  if (
    !result ||
    typeof result !== "object" ||
    !("skipped" in result) ||
    result.skipped !== true
  )
    return null;
  if (taskName === "publication-reconciliation")
    return "PUBLICATION_KEY_NOT_CONFIGURED";
  if (taskName === "tencent-enterprise-sync")
    return runtimeTaskErrorCode(taskName, {
      code: "reason" in result ? result.reason : "ANSWERBIT_KEY_NOT_CONFIGURED",
    });
  return null;
}
