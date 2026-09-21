import { describe, expect, it } from "vitest";
import { buildExposureTrendData } from "./overview-trend";

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
});
