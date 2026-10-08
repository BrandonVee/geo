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
