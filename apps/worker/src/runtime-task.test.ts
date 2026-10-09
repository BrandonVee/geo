import { describe, expect, it } from "vitest";
import {
  runtimeTaskErrorCode,
  skippedRuntimeTaskErrorCode,
} from "./runtime-task";

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

describe("周期任务跳过结果", () => {
  it("缺少 Key 的跳过不能记录为成功", () => {
    expect(
      skippedRuntimeTaskErrorCode("publication-reconciliation", {
        skipped: true,
      }),
    ).toBe("PUBLICATION_KEY_NOT_CONFIGURED");
    expect(
      skippedRuntimeTaskErrorCode("tencent-enterprise-sync", {
        skipped: true,
        reason: "ANSWERBIT_KEY_NOT_ACTIVE",
      }),
    ).toBe("ANSWERBIT_KEY_NOT_ACTIVE");
  });
  it("有效目录仍新鲜或实际执行成功时正常完成", () => {
    expect(
      skippedRuntimeTaskErrorCode("tencent-enterprise-sync", undefined),
    ).toBeNull();
    expect(
      skippedRuntimeTaskErrorCode("publication-reconciliation", { checked: 0 }),
    ).toBeNull();
    expect(
      skippedRuntimeTaskErrorCode("publication-reconciliation", {
        skipped: false,
      }),
    ).toBeNull();
  });
});
