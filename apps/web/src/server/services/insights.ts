import type {
  CitationRankQuery,
  DashboardBaseQuery,
  TaskListQuery,
} from "@geo/contracts";
import { loadAnswerBitTeamContext } from "@/server/integrations/answerbit/context";
import {
  queryArticleRankLogged,
  queryArticleTagsLogged,
  queryDomainRankLogged,
  queryPromptTrendsLogged,
  queryTaskDetailLogged,
  queryTasksLogged,
  queryTitleRankLogged,
} from "@/server/integrations/answerbit/gateway";
import {
  authorizeBrand,
  resolveBrandScope,
} from "@/server/permissions/brand-scope";
import { mapUpstreamError } from "./answerbit-connections";

type Scope = { organizationId: string; teamBindingId: string; brandId: string };
async function prepare(scope: Scope, userId: string, requestId: string) {
  await authorizeBrand(
    scope.organizationId,
    scope.teamBindingId,
    scope.brandId,
    userId,
    "resource.read",
    "geo_insights",
  );
  const value = await loadAnswerBitTeamContext(
    scope.organizationId,
    scope.teamBindingId,
  );
  return {
    ...value,
    log: {
      organizationId: scope.organizationId,
      connectionId: value.connection.id,
      requestId,
      actorUserId: userId,
      brandId: scope.brandId,
    },
  };
}
const baseFilter = (input: CitationRankQuery | DashboardBaseQuery) => ({
  brand_id: input.brandId,
  begin_date: input.beginDate,
  end_date: input.endDate,
  title_ids: input.titleIds,
  platforms: input.platforms,
  tag_ids: input.tagIds,
});
export const insightService = {
  async tasks(input: TaskListQuery, userId: string, requestId: string) {
    const { apiKey, log } = await prepare(input, userId, requestId);
    try {
      return await queryTasksLogged(
        apiKey,
        {
          brand_id: input.brandId,
          begin_date: input.beginDate,
          end_date: input.endDate,
          include: input.include,
          prompt: input.prompt,
          title_id: input.titleIds,
          prompt_ids: input.promptIds,
          tag_ids: input.tagIds,
          task_ids: input.taskIds,
          platforms: input.platforms,
          language: input.languages,
          mention_brand: input.mentionBrand,
          min_score: input.minScore,
          max_score: input.maxScore,
          url: input.url,
          ref_platform: input.refPlatform,
          article_id: input.articleId,
          page: input.page,
          page_size: input.pageSize,
        },
        log,
      );
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
  async taskDetail(
    scope: Scope,
    taskId: string,
    userId: string,
    requestId: string,
  ) {
    const { apiKey, log } = await prepare(scope, userId, requestId);
    try {
      return await queryTaskDetailLogged(apiKey, scope.brandId, taskId, log);
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
  async domainRank(
    input: CitationRankQuery,
    userId: string,
    requestId: string,
  ) {
    const { apiKey, log } = await prepare(input, userId, requestId);
    try {
      return await queryDomainRankLogged(
        apiKey,
        {
          ...baseFilter(input),
          prompt_ids: input.promptIds,
          domain: input.keyword,
          page: input.page,
          page_size: input.pageSize,
        },
        log,
      );
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
  async articleRank(
    input: CitationRankQuery,
    userId: string,
    requestId: string,
  ) {
    const { apiKey, log } = await prepare(input, userId, requestId);
    try {
      return await queryArticleRankLogged(
        apiKey,
        {
          ...baseFilter(input),
          prompt_ids: input.promptIds,
          keyword: input.keyword,
          page: input.page,
          page_size: input.pageSize,
        },
        log,
      );
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
  async promptTrends(
    input: DashboardBaseQuery,
    userId: string,
    requestId: string,
  ) {
    const { apiKey, log } = await prepare(input, userId, requestId);
    try {
      const { platforms: _, ...filter } = baseFilter(input);
      void _;
      return await queryPromptTrendsLogged(apiKey, filter, log);
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
  async titleRank(
    input: DashboardBaseQuery,
    userId: string,
    requestId: string,
  ) {
    const { apiKey, log } = await prepare(input, userId, requestId);
    try {
      return await queryTitleRankLogged(apiKey, baseFilter(input), log);
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
  async tags(
    organizationId: string,
    teamBindingId: string,
    tagType: 1 | 2 | undefined,
    userId: string,
    requestId: string,
  ) {
    await resolveBrandScope(
      organizationId,
      teamBindingId,
      userId,
      "resource.read",
    );
    const { team, connection, apiKey } = await loadAnswerBitTeamContext(
      organizationId,
      teamBindingId,
    );
    try {
      return await queryArticleTagsLogged(apiKey, team.teamId, tagType, {
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
