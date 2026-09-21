import {
  dashboardBaseQuerySchema,
  dashboardQuerySchema,
  type DashboardBaseQuery,
  type DashboardQuery,
} from "@geo/contracts";
import { ApiError } from "./errors";

export function parseDashboardQuery(
  request: Request,
  includeCompetitors: false,
): DashboardBaseQuery;
export function parseDashboardQuery(
  request: Request,
  includeCompetitors?: true,
): DashboardQuery;
export function parseDashboardQuery(
  request: Request,
  includeCompetitors = true,
): DashboardQuery | DashboardBaseQuery {
  const parsed = (
    includeCompetitors ? dashboardQuerySchema : dashboardBaseQuerySchema
  ).safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success)
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "概览筛选参数有误",
      parsed.error.issues,
    );
  return parsed.data;
}
