export function stableErrorCode(error: unknown, fallback: string) {
  const value =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : error instanceof Error
        ? error.message
        : undefined;
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{2,127}$/.test(value)
    ? value
    : fallback;
}
