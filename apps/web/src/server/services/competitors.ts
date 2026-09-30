import type {
  CreateCompetitorInput,
  UpdateCompetitorInput,
} from "@geo/contracts";
import type { AuditContext } from "@/server/audit/write-audit";
import { writeAudit } from "@/server/audit/write-audit";
import { loadAnswerBitTeamContext } from "@/server/integrations/answerbit/context";
import {
  createCompetitorLogged,
  deleteCompetitorLogged,
  queryCompetitorsLogged,
  updateCompetitorLogged,
} from "@/server/integrations/answerbit/gateway";
import { authorizeBrand } from "@/server/permissions/brand-scope";
import { competitorRepository } from "@/server/repositories/competitors";
import { mapUpstreamError } from "./answerbit-connections";

const context = (
  organizationId: string,
  connectionId: string,
  requestId: string,
  actorUserId: string,
  brandId: string,
) => ({ organizationId, connectionId, requestId, actorUserId, brandId });
export const competitorService = {
  async list(
    organizationId: string,
    teamBindingId: string,
    brandId: string,
    userId: string,
    requestId: string,
  ) {
    await authorizeBrand(
      organizationId,
      teamBindingId,
      brandId,
      userId,
      "resource.read",
      "geo_insights",
    );
    const { connection, apiKey } = await loadAnswerBitTeamContext(
      organizationId,
      teamBindingId,
    );
    try {
      const rows = await queryCompetitorsLogged(
        apiKey,
        brandId,
        context(organizationId, connection.id, requestId, userId, brandId),
      );
      await competitorRepository.sync(
        organizationId,
        teamBindingId,
        brandId,
        rows,
      );
      return rows;
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
  async create(
    input: CreateCompetitorInput,
    userId: string,
    requestId: string,
    audit: AuditContext,
  ) {
    await authorizeBrand(
      input.organizationId,
      input.teamBindingId,
      input.brandId,
      userId,
      "resource.create",
      "geo_insights",
    );
    const { connection, apiKey } = await loadAnswerBitTeamContext(
      input.organizationId,
      input.teamBindingId,
    );
    try {
      const result = await createCompetitorLogged(
        apiKey,
        {
          brand_id: input.brandId,
          competitor_name: input.competitorName,
          competitor_alias: input.competitorAlias,
        },
        context(
          input.organizationId,
          connection.id,
          requestId,
          userId,
          input.brandId,
        ),
      );
      const record = await competitorRepository.save({
        organizationId: input.organizationId,
        teamBindingId: input.teamBindingId,
        brandId: input.brandId,
        competitorId: result.id,
        competitorName: input.competitorName,
        competitorAlias: input.competitorAlias,
      });
      await writeAudit(audit, {
        operation: "answerbit.competitor.create",
        resourceType: "answerbit_competitor",
        resourceId: result.id,
        summary: `创建竞品 ${input.competitorName}`,
      });
      return record;
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
  async update(
    competitorId: string,
    input: UpdateCompetitorInput,
    userId: string,
    requestId: string,
    audit: AuditContext,
  ) {
    await authorizeBrand(
      input.organizationId,
      input.teamBindingId,
      input.brandId,
      userId,
      "resource.update",
      "geo_insights",
    );
    const { connection, apiKey } = await loadAnswerBitTeamContext(
      input.organizationId,
      input.teamBindingId,
    );
    try {
      await updateCompetitorLogged(
        apiKey,
        {
          brand_id: input.brandId,
          competitor_id: competitorId,
          competitor_name: input.competitorName,
          competitor_alias: input.competitorAlias,
        },
        context(
          input.organizationId,
          connection.id,
          requestId,
          userId,
          input.brandId,
        ),
      );
      const record = await competitorRepository.save({
        organizationId: input.organizationId,
        teamBindingId: input.teamBindingId,
        brandId: input.brandId,
        competitorId,
        competitorName: input.competitorName,
        competitorAlias: input.competitorAlias,
      });
      await writeAudit(audit, {
        operation: "answerbit.competitor.update",
        resourceType: "answerbit_competitor",
        resourceId: competitorId,
        summary: `更新竞品 ${input.competitorName}`,
      });
      return record;
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
  async remove(
    organizationId: string,
    teamBindingId: string,
    brandId: string,
    competitorId: string,
    userId: string,
    requestId: string,
    audit: AuditContext,
  ) {
    await authorizeBrand(
      organizationId,
      teamBindingId,
      brandId,
      userId,
      "resource.delete",
      "geo_insights",
    );
    const { connection, apiKey } = await loadAnswerBitTeamContext(
      organizationId,
      teamBindingId,
    );
    try {
      await deleteCompetitorLogged(
        apiKey,
        { brand_id: brandId, competitor_id: competitorId },
        context(organizationId, connection.id, requestId, userId, brandId),
      );
      await competitorRepository.remove(
        organizationId,
        teamBindingId,
        brandId,
        competitorId,
      );
      await writeAudit(audit, {
        operation: "answerbit.competitor.delete",
        resourceType: "answerbit_competitor",
        resourceId: competitorId,
        summary: "删除竞品",
      });
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
};
