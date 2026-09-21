export type ExposureTrendInput = {
  brand_statistics: {
    date: string;
    name?: string;
    exposure: number;
  }[];
  competitor_statistics: {
    name: string;
    statistics: {
      date: string;
      exposure: number;
    }[];
  }[];
};

export type ExposureTrendPoint = {
  date: string;
  exposure: number;
  series: string;
};

export function buildExposureTrendData(
  data: ExposureTrendInput | null,
): ExposureTrendPoint[] {
  if (!data) return [];
  return [
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
  ].sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.series.localeCompare(right.series, "zh-CN"),
  );
}
