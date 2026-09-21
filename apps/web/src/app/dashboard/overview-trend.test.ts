import { describe, expect, it } from "vitest";
import {
  buildAverageRankTrendData,
  buildExposureTrendData,
  buildScoreTrendData,
  buildTaskCountTrendData,
} from "./overview-trend";

describe("buildExposureTrendData", () => {
  it("orders every series from the oldest date to the newest date", () => {
    const points = buildExposureTrendData({
      brand_statistics: [
        { date: "2026-09-20", exposure: 30 },
        { date: "2026-08-22", exposure: 10 },
      ],
      competitor_statistics: [
        {
          name: "竞品",
          statistics: [
            { date: "2026-09-20", exposure: 20 },
            { date: "2026-08-22", exposure: 5 },
          ],
        },
      ],
    });

    expect(points.map((point) => point.date)).toEqual([
      "2026-08-22",
      "2026-08-22",
      "2026-09-20",
      "2026-09-20",
    ]);
  });

  it("builds ranking, score and monitoring-volume perspectives", () => {
    const exposure = {
      brand_statistics: [
        {
          date: "2026-09-20",
          exposure: 30,
          avg_rank: 2.5,
          task_count: 18,
        },
      ],
      competitor_statistics: [
        {
          name: "竞品",
          statistics: [
            {
              date: "2026-09-20",
              exposure: 20,
              avg_rank: 3.2,
              task_count: 15,
            },
          ],
        },
      ],
    };
    expect(buildAverageRankTrendData(exposure)).toEqual([
      { date: "2026-09-20", value: 2.5, series: "当前品牌" },
      { date: "2026-09-20", value: 3.2, series: "竞品" },
    ]);
    expect(buildTaskCountTrendData(exposure)).toEqual([
      { date: "2026-09-20", value: 18, series: "当前品牌" },
    ]);
    expect(
      buildScoreTrendData({
        brand_statistics: [{ date: "2026-09-20", score: 78 }],
        competitor_statistics: [
          {
            name: "竞品",
            statistics: [{ date: "2026-09-20", score: 66 }],
          },
        ],
      }),
    ).toEqual([
      { date: "2026-09-20", value: 78, series: "当前品牌" },
      { date: "2026-09-20", value: 66, series: "竞品" },
    ]);
  });
});
