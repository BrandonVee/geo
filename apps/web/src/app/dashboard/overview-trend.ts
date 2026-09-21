export type ExposureTrendInput = {
  brand_statistics: {
    date: string;
    name?: string;
    exposure: number;
    avg_rank?: number;
    task_count?: number;
  }[];
  competitor_statistics: {
    name: string;
    statistics: {
      date: string;
      exposure: number;
      avg_rank?: number;
      task_count?: number;
    }[];
  }[];
};

export type ScoreTrendInput = {
  brand_statistics: {
    date: string;
    name?: string;
    score: number;
    task_count?: number;
  }[];
  competitor_statistics: {
    name: string;
    statistics: {
      date: string;
      score: number;
      task_count?: number;
    }[];
  }[];
};

export type ExposureTrendPoint = {
  date: string;
  exposure: number;
  series: string;
};

export type OverviewTrendPoint = {
  date: string;
  value: number;
  series: string;
};

const sortTrendPoints = <T extends { date: string; series: string }>(
  points: T[],
) =>
  points.sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.series.localeCompare(right.series, "zh-CN"),
  );

export function buildExposureTrendData(
  data: ExposureTrendInput | null,
): ExposureTrendPoint[] {
  if (!data) return [];
  return sortTrendPoints([
    ...data.brand_statistics.map((point) => ({
      date: point.date,
      exposure: point.exposure,
      series: point.name ?? "当前品牌",
    })),
    ...data.competitor_statistics.flatMap((item) =>
      item.statistics.map((point) => ({
        date: point.date,
        exposure: point.exposure,
        series: item.name,
      })),
    ),
  ]);
}

export function buildAverageRankTrendData(
  data: ExposureTrendInput | null,
): OverviewTrendPoint[] {
  if (!data) return [];
  return sortTrendPoints([
    ...data.brand_statistics.flatMap((point) =>
      point.avg_rank === undefined
        ? []
        : [
            {
              date: point.date,
              value: point.avg_rank,
              series: point.name ?? "当前品牌",
            },
          ],
    ),
    ...data.competitor_statistics.flatMap((item) =>
      item.statistics.flatMap((point) =>
        point.avg_rank === undefined
          ? []
          : [
              {
                date: point.date,
                value: point.avg_rank,
                series: item.name,
              },
            ],
      ),
    ),
  ]);
}

export function buildTaskCountTrendData(
  data: ExposureTrendInput | null,
): OverviewTrendPoint[] {
  if (!data) return [];
  return sortTrendPoints(
    data.brand_statistics.flatMap((point) =>
      point.task_count === undefined
        ? []
        : [
            {
              date: point.date,
              value: point.task_count,
              series: point.name ?? "当前品牌",
            },
          ],
    ),
  );
}

export function buildScoreTrendData(
  data: ScoreTrendInput | null,
): OverviewTrendPoint[] {
  if (!data) return [];
  return sortTrendPoints([
    ...data.brand_statistics.map((point) => ({
      date: point.date,
      value: point.score,
      series: point.name ?? "当前品牌",
    })),
    ...data.competitor_statistics.flatMap((item) =>
      item.statistics.map((point) => ({
        date: point.date,
        value: point.score,
        series: item.name,
      })),
    ),
  ]);
}
