import { describe, expect, it } from "vitest";
import { runtimeTaskErrorCode } from "./runtime-task";

describe("Worker 周期任务错误码", () => {
  it("保留 Error message 中的稳定错误码", () => {
    expect(
      runtimeTaskErrorCode(
        "publication-reconciliation",
        new Error("PUBLICATION_RECONCILIATION_PARTIAL_FAILURE"),
      ),
    ).toBe("PUBLICATION_RECONCILIATION_PARTIAL_FAILURE");
  });

  it("优先读取数据库或上游错误对象的 code", () => {
    expect(
      runtimeTaskErrorCode("billing-maintenance", {
        code: "DATABASE_CONNECTION_LOST",
      }),
    ).toBe("DATABASE_CONNECTION_LOST");
  });

  it("不暴露自由文本并按任务名生成回退码", () => {
    expect(
      runtimeTaskErrorCode(
        "tencent-enterprise-sync",
        new Error("request failed for tenant 42"),
      ),
    ).toBe("TENCENT_ENTERPRISE_SYNC_FAILED");
    expect(runtimeTaskErrorCode("notification-evaluation", null)).toBe(
      "NOTIFICATION_EVALUATION_FAILED",
    );
  });
});
