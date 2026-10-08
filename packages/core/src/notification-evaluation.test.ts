import { describe, expect, it } from "vitest";
import {
  classifyConnectionFailure,
  classifyMetricAnomaly,
  connectionFailureCriticalThreshold,
  connectionFailureLookbackLimit,
  countConsecutiveFailures,
  notificationMetricPeriod,
} from "./notification-evaluation";

describe("通知指标日期窗口", () => {
  it.each([
    [1, "2026-03-07T23:55:00Z", "2026-03-07", "2026-03-07"],
    [7, "2026-01-01T00:00:00Z", "2025-12-26", "2026-01-01"],
    [7, "2024-03-01T12:00:00Z", "2024-02-24", "2024-03-01"],
    [30, "2026-03-08T00:05:00+08:00", "2026-02-06", "2026-03-07"],
  ])(
    "%i 天窗口按 UTC 闭合日期处理跨年、闰日及本地日期边界",
    (days, timestamp, beginDate, endDate) => {
      const now = new Date(timestamp);
      expect(notificationMetricPeriod(days, now)).toEqual({
        beginDate,
        endDate,
      });
      expect(now.toISOString()).toBe(new Date(timestamp).toISOString());
    },
  );
});

describe("连接连续失败判定", () => {
  it("从最新记录开始计数，并在第一次成功处复位", () => {
    expect(
      countConsecutiveFailures([
        { status: "failed" },
        { status: "timeout" },
        { status: "success" },
        { status: "failed" },
      ]),
    ).toBe(2);
    expect(countConsecutiveFailures([{ status: "success" }])).toBe(0);
  });

  it("达到规则阈值时告警，达到扩大窗口时升级为严重", () => {
    expect(classifyConnectionFailure(2, 3)).toEqual({
      consecutiveFailures: 2,
      triggered: false,
      severity: null,
    });
    expect(classifyConnectionFailure(3, 3)).toEqual({
      consecutiveFailures: 3,
      triggered: true,
      severity: "warning",
    });
    expect(classifyConnectionFailure(6, 3)).toEqual({
      consecutiveFailures: 6,
      triggered: true,
      severity: "critical",
    });
  });

  it("读取足够的历史记录以覆盖严重级别边界", () => {
    expect(connectionFailureCriticalThreshold(1)).toBe(5);
    expect(connectionFailureLookbackLimit(3)).toBe(6);
    expect(connectionFailureLookbackLimit(20)).toBe(40);
  });
});

describe("核心指标异常判定", () => {
  it("提及率和得分下降触发，平均排名上升触发", () => {
    expect(classifyMetricAnomaly("exposure", -20, 20)).toMatchObject({
      anomalous: true,
      direction: "down",
      severity: "warning",
    });
    expect(classifyMetricAnomaly("score", 20, 20).anomalous).toBe(false);
    expect(classifyMetricAnomaly("avg_rank", 20, 20)).toMatchObject({
      anomalous: true,
      direction: "up",
      severity: "warning",
    });
    expect(classifyMetricAnomaly("avg_rank", -20, 20).anomalous).toBe(false);
  });

  it("波动达到两倍阈值时升级为严重", () => {
    expect(classifyMetricAnomaly("score", -40, 20).severity).toBe("critical");
    expect(classifyMetricAnomaly("avg_rank", 40, 20).severity).toBe("critical");
  });
});
