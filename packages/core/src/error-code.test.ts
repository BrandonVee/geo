import { describe, expect, it } from "vitest";
import { stableErrorCode } from "./error-code";

describe("稳定错误码", () => {
  it("保留稳定业务错误码且优先使用显式 code", () => {
    expect(stableErrorCode(new Error("ANSWERBIT_TIMEOUT"), "FAILED")).toBe(
      "ANSWERBIT_TIMEOUT",
    );
    expect(
      stableErrorCode(
        Object.assign(new Error("private upstream details"), {
          code: "DATABASE_CONNECTION_LOST",
        }),
        "FAILED",
      ),
    ).toBe("DATABASE_CONNECTION_LOST");
  });
  it.each([
    new Error("Failed query: insert into notifications ... params: secret"),
    new Error("request failed for https://user:secret@example.test"),
    Object.assign(new Error("ANSWERBIT_TIMEOUT"), {
      code: "private\nlog injection",
    }),
    new Error("X".repeat(129)),
    null,
    "ANSWERBIT_TIMEOUT",
  ])("自由文本、超长或非结构化错误不进入健康状态和日志", (error) => {
    expect(stableErrorCode(error, "NOTIFICATION_EVALUATION_FAILED")).toBe(
      "NOTIFICATION_EVALUATION_FAILED",
    );
  });
});
