import type { RuntimeTaskName } from "@geo/core";

export function runtimeTaskErrorCode(
  taskName: RuntimeTaskName,
  error: unknown,
) {
  const value =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : error instanceof Error
        ? error.message
        : undefined;
  if (typeof value === "string" && /^[A-Z][A-Z0-9_]{2,127}$/.test(value))
    return value;
  return `${taskName.replaceAll("-", "_").toUpperCase()}_FAILED`;
}
