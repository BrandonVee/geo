import type { DashboardBaseQuery, DashboardQuery } from "@geo/contracts";
import { stableErrorCode } from "@geo/core";
import { loadAnswerBitTeamContext } from "@/server/integrations/answerbit/context";
import {
  queryDashboardMetricsLogged,
  queryExposureRankLogged,
  queryExposureTrendsLogged,
  queryFilterPlatformsLogged,
  queryScoreRankLogged,
  queryScoreTrendsLogged,
} from "@/server/integrations/answerbit/gateway";
import {
  authorizeBrand,
  resolveBrandScope,
} from "@/server/permissions/brand-scope";
import { mapUpstreamError } from "./answerbit-connections";
import { evaluateMetricAnomaly } from "./notifications";

const payload = (input: DashboardQuery | DashboardBaseQuery) => ({
  brand_id: input.brandId,
  begin_date: input.beginDate,
  end_date: input.endDate,
  title_ids: input.titleIds,
  ...("competitorIds" in input ? { competitor_ids: input.competitorIds } : {}),
  platforms: input.platforms,
  tag_ids: input.tagIds,
});
async function prepare(
  input: DashboardQuery | DashboardBaseQuery,
  userId: string,
  requestId: string,
) {
  await authorizeBrand(
    input.organizationId,
    input.teamBindingId,
    input.brandId,
    userId,
    "resource.read",
    "geo_insights",
  );
  const answerBit = await loadAnswerBitTeamContext(
    input.organizationId,
    input.teamBindingId,
  );
  return {
    ...answerBit,
    log: {
      organizationId: input.organizationId,
      connectionId: answerBit.connection.id,
      requestId,
      actorUserId: userId,
      brandId: input.brandId,
    },
  };
}
export const dashboardService = {
  async metrics(input: DashboardBaseQuery, userId: string, requestId: string) {
    const { apiKey, log } = await prepare(input, userId, requestId);
    try {
      return await queryDashboardMetricsLogged(
        apiKey,
        payload(input),
        log,
        (result) =>
          evaluateMetricAnomaly(
            input.organizationId,
            input.teamBindingId,
            input.brandId,
            result,
            input,
          ).catch((error) =>
            console.error(
              JSON.stringify({
                event: "notification.metric.failed",
                requestId,
                errorCode: stableErrorCode(
                  error,
                  "NOTIFICATION_EVALUATION_FAILED",
                ),
              }),
            ),
          ),
      );
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
  async exposureTrends(
    input: DashboardQuery,
    userId: string,
    requestId: string,
  ) {
    const { apiKey, log } = await prepare(input, userId, requestId);
    try {
      return await queryExposureTrendsLogged(apiKey, payload(input), log);
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
  async scoreTrends(input: DashboardQuery, userId: string, requestId: string) {
    const { apiKey, log } = await prepare(input, userId, requestId);
    try {
      return await queryScoreTrendsLogged(apiKey, payload(input), log);
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
  async exposureRank(input: DashboardQuery, userId: string, requestId: string) {
    const { apiKey, log } = await prepare(input, userId, requestId);
    try {
      return await queryExposureRankLogged(apiKey, payload(input), log);
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
  async scoreRank(input: DashboardQuery, userId: string, requestId: string) {
    const { apiKey, log } = await prepare(input, userId, requestId);
    try {
      return await queryScoreRankLogged(apiKey, payload(input), log);
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
  async platforms(
    organizationId: string,
    teamBindingId: string,
    userId: string,
    requestId: string,
  ) {
    await resolveBrandScope(
      organizationId,
      teamBindingId,
      userId,
      "resource.read",
      "geo_insights",
    );
    const { team, connection, apiKey } = await loadAnswerBitTeamContext(
      organizationId,
      teamBindingId,
    );
    try {
      return await queryFilterPlatformsLogged(apiKey, team.teamId, {
        organizationId,
        connectionId: connection.id,
        requestId,
        actorUserId: userId,
      });
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
};
