import type {
  CreateCategoryInput,
  CreatePromptInput,
  CreatePromptsBatchInput,
  MovePromptInput,
  PromptListQuery,
  UpdateCategoryInput,
  UpdatePromptInput,
} from "@geo/contracts";
import type { AuditContext } from "@/server/audit/write-audit";
import { writeAudit } from "@/server/audit/write-audit";
import { loadAnswerBitTeamContext } from "@/server/integrations/answerbit/context";
import {
  createPromptLogged,
  createPromptsBatchLogged,
  createTitleLogged,
  deletePromptLogged,
  deletePromptsBatchLogged,
  deleteTitleLogged,
  movePromptLogged,
  queryPromptGroupsLogged,
  queryTitlesLogged,
  updatePromptLogged,
  updateTitleLogged,
} from "@/server/integrations/answerbit/gateway";
import { authorizeBrand } from "@/server/permissions/brand-scope";
import { promptRepository } from "@/server/repositories/prompts";
import { mapUpstreamError } from "./answerbit-connections";

type Scope = { organizationId: string; teamBindingId: string; brandId: string };
const logContext = (
  scope: Scope,
  connectionId: string,
  requestId: string,
  actorUserId: string,
) => ({
  organizationId: scope.organizationId,
  connectionId,
  requestId,
  actorUserId,
  brandId: scope.brandId,
});
async function prepare(
  scope: Scope,
  userId: string,
  permission:
    | "resource.read"
    | "resource.create"
    | "resource.update"
    | "resource.delete",
  feature: "geo_insights" | "content" = "geo_insights",
) {
  await authorizeBrand(
    scope.organizationId,
    scope.teamBindingId,
    scope.brandId,
    userId,
    permission,
    feature,
  );
  return loadAnswerBitTeamContext(scope.organizationId, scope.teamBindingId);
}

export const categoryService = {
  async list(
    scope: Scope,
    filters: { id?: string; titleName?: string },
    userId: string,
    requestId: string,
  ) {
    const { connection, apiKey } = await prepare(
      scope,
      userId,
      "resource.read",
    );
    try {
      const rows = await queryTitlesLogged(
        apiKey,
        {
          brand_id: scope.brandId,
          id: filters.id,
          title_name: filters.titleName,
        },
        logContext(scope, connection.id, requestId, userId),
      );
      await promptRepository.syncTitles(scope, rows);
      return rows;
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
  async create(
    input: CreateCategoryInput,
    userId: string,
    requestId: string,
    audit: AuditContext,
  ) {
    const { connection, apiKey } = await prepare(
      input,
      userId,
      "resource.create",
    );
    try {
      const result = await createTitleLogged(
        apiKey,
        {
          brand_id: input.brandId,
          title_name: input.titleName,
          title_desc: input.titleDescription,
        },
        logContext(input, connection.id, requestId, userId),
      );
      const record = await promptRepository.saveTitle(
        input,
        result.id,
        input.titleName,
        input.titleDescription,
      );
      await writeAudit(audit, {
        operation: "answerbit.title.create",
        resourceType: "answerbit_title",
        resourceId: result.id,
        summary: `创建问题分类 ${input.titleName}`,
      });
      return record;
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
  async update(
    titleId: string,
    input: UpdateCategoryInput,
    userId: string,
    requestId: string,
    audit: AuditContext,
  ) {
    const { connection, apiKey } = await prepare(
      input,
      userId,
      "resource.update",
    );
    try {
      await updateTitleLogged(
        apiKey,
        {
          id: titleId,
          brand_id: input.brandId,
          title_name: input.titleName,
          title_desc: input.titleDescription,
        },
        logContext(input, connection.id, requestId, userId),
      );
      const record = await promptRepository.updateTitle(input, titleId, {
        titleName: input.titleName,
        ...(input.titleDescription !== undefined
          ? { titleDescription: input.titleDescription }
          : {}),
      });
      await writeAudit(audit, {
        operation: "answerbit.title.update",
        resourceType: "answerbit_title",
        resourceId: titleId,
        summary: `更新问题分类 ${input.titleName}`,
      });
      return (
        record ?? {
          titleId,
          titleName: input.titleName,
          titleDescription: input.titleDescription,
        }
      );
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
  async remove(
    scope: Scope,
    titleId: string,
    userId: string,
    requestId: string,
    audit: AuditContext,
  ) {
    const { connection, apiKey } = await prepare(
      scope,
      userId,
      "resource.delete",
    );
    try {
      await deleteTitleLogged(
        apiKey,
        titleId,
        logContext(scope, connection.id, requestId, userId),
      );
      await promptRepository.removeTitle(scope, titleId);
      await writeAudit(audit, {
        operation: "answerbit.title.delete",
        resourceType: "answerbit_title",
        resourceId: titleId,
        summary: "删除问题分类",
      });
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
};

export const promptService = {
  async list(input: PromptListQuery, userId: string, requestId: string) {
    const { connection, apiKey } = await prepare(
      input,
      userId,
      "resource.read",
      input.purpose === "content" ? "content" : "geo_insights",
    );
    try {
      const data = await queryPromptGroupsLogged(
        apiKey,
        {
          brand_id: input.brandId,
          group_type: 1,
          begin_date: input.beginDate,
          end_date: input.endDate,
          page: input.page,
          page_size: input.pageSize,
          title_ids: input.titleIds,
          tag_ids: input.tagIds,
          platforms: input.platforms,
          query_str: input.query,
        },
        logContext(input, connection.id, requestId, userId),
      );
      await promptRepository.syncPromptGroups(input, data.titles);
      return data;
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
  async create(
    input: CreatePromptInput,
    userId: string,
    requestId: string,
    audit: AuditContext,
  ) {
    const { connection, apiKey } = await prepare(
      input,
      userId,
      "resource.create",
    );
    try {
      const result = await createPromptLogged(
        apiKey,
        {
          brand_id: input.brandId,
          title_id: input.titleId,
          query_str: input.query,
          recommend_id: input.recommendId,
        },
        logContext(input, connection.id, requestId, userId),
      );
      const record = await promptRepository.savePrompt(
        input,
        result.id,
        input.titleId,
        input.query,
      );
      await writeAudit(audit, {
        operation: "answerbit.prompt.create",
        resourceType: "answerbit_prompt",
        resourceId: result.id,
        summary: "创建监控问题",
      });
      return record;
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
  async createBatch(
    input: CreatePromptsBatchInput,
    userId: string,
    requestId: string,
    audit: AuditContext,
  ) {
    const { connection, apiKey } = await prepare(
      input,
      userId,
      "resource.create",
    );
    try {
      const result = await createPromptsBatchLogged(
        apiKey,
        {
          brand_id: input.brandId,
          title_id: input.titleId,
          prompts: input.prompts,
          recommend_ids: input.recommendIds,
        },
        logContext(input, connection.id, requestId, userId),
      );
      await Promise.all(
        result.prompt_ids.map((id, index) =>
          promptRepository.savePrompt(
            input,
            id,
            input.titleId,
            input.prompts[index] ?? "",
          ),
        ),
      );
      await writeAudit(audit, {
        operation: "answerbit.prompt.create_batch",
        resourceType: "answerbit_prompt",
        summary: `批量创建 ${result.prompt_ids.length} 个监控问题`,
      });
      return result;
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
  async update(
    scope: Scope,
    promptId: string,
    input: UpdatePromptInput,
    userId: string,
    requestId: string,
    audit: AuditContext,
  ) {
    const { connection, apiKey } = await prepare(
      scope,
      userId,
      "resource.update",
    );
    try {
      await updatePromptLogged(
        apiKey,
        {
          id: promptId,
          brand_id: scope.brandId,
          query_str: input.query,
          status: input.status,
        },
        logContext(scope, connection.id, requestId, userId),
      );
      await promptRepository.updatePrompt(scope, promptId, {
        query: input.query,
        status: input.status,
      });
      await writeAudit(audit, {
        operation: "answerbit.prompt.update",
        resourceType: "answerbit_prompt",
        resourceId: promptId,
        summary: "更新监控问题",
      });
      return { id: promptId, query: input.query, status: input.status };
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
  async move(
    scope: Scope,
    promptId: string,
    input: MovePromptInput,
    userId: string,
    requestId: string,
    audit: AuditContext,
  ) {
    const { connection, apiKey } = await prepare(
      scope,
      userId,
      "resource.update",
    );
    try {
      await movePromptLogged(
        apiKey,
        {
          brand_id: scope.brandId,
          title_id: input.titleId,
          prompt_id: promptId,
        },
        logContext(scope, connection.id, requestId, userId),
      );
      await promptRepository.updatePrompt(scope, promptId, {
        titleId: input.titleId,
      });
      await writeAudit(audit, {
        operation: "answerbit.prompt.move",
        resourceType: "answerbit_prompt",
        resourceId: promptId,
        summary: "移动监控问题分类",
      });
      return { id: promptId, titleId: input.titleId };
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
  async remove(
    scope: Scope,
    promptId: string,
    userId: string,
    requestId: string,
    audit: AuditContext,
  ) {
    const { connection, apiKey } = await prepare(
      scope,
      userId,
      "resource.delete",
    );
    try {
      await deletePromptLogged(
        apiKey,
        { id: promptId, brand_id: scope.brandId },
        logContext(scope, connection.id, requestId, userId),
      );
      await promptRepository.removePrompts(scope, [promptId]);
      await writeAudit(audit, {
        operation: "answerbit.prompt.delete",
        resourceType: "answerbit_prompt",
        resourceId: promptId,
        summary: "删除监控问题",
      });
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
  async removeBatch(
    scope: Scope,
    promptIds: string[],
    userId: string,
    requestId: string,
    audit: AuditContext,
  ) {
    const { connection, apiKey } = await prepare(
      scope,
      userId,
      "resource.delete",
    );
    try {
      await deletePromptsBatchLogged(
        apiKey,
        { prompt_ids: promptIds, brand_id: scope.brandId },
        logContext(scope, connection.id, requestId, userId),
      );
      await promptRepository.removePrompts(scope, promptIds);
      await writeAudit(audit, {
        operation: "answerbit.prompt.delete_batch",
        resourceType: "answerbit_prompt",
        summary: `批量删除 ${promptIds.length} 个监控问题`,
      });
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
};
