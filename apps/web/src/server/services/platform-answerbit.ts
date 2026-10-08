import type {
  AdminCreateAnswerBitBrandInput,
  AdminSetAnswerBitCredentialInput,
  AdminUpdateAnswerBitBrandIconInput,
  AdminUpdateAnswerBitBrandInput,
} from "@geo/contracts";
import { syncTencentEnterpriseDirectory } from "@geo/db";
import {
  answerBitOperations,
  maskSecret,
  platformAnswerBitCredentialAad,
} from "@geo/core";
import type { AuditContext } from "@/server/audit/write-audit";
import { writeAudit } from "@/server/audit/write-audit";
import { ApiError } from "@/server/http/errors";
import { AnswerBitError } from "@/server/integrations/answerbit/errors";
import {
  buildBrandUpdatePayload,
  createBrand as createAnswerBitBrand,
  createBrandBundle as createAnswerBitBrandBundle,
  deleteBrand as deleteAnswerBitBrand,
  getBrandDetail as getAnswerBitBrandDetail,
  queryBrands,
  updateBrand as updateAnswerBitBrand,
  updateBrandIcon as updateAnswerBitBrandIcon,
} from "@/server/integrations/answerbit/modules/brands";
import { requirePlatformPermission } from "@/server/permissions/platform";
import { platformAnswerbitRepository as repository } from "@/server/repositories/platform-answerbit";
import { getSecretCipher } from "@/server/security/secret-cipher";
import { mapUpstreamError } from "./answerbit-connections";
import { organizationService } from "./organizations";

async function publicConfiguration() {
  const [configuration, brands] = await Promise.all([
    repository.getConfiguration(),
    repository.listBrands(),
  ]);
  const configured = Boolean(configuration?.teamId);
  return {
    configured,
    status: configured ? configuration!.status : ("missing" as const),
    teamId: configuration?.teamId ?? null,
    apiKeyHint: configured ? configuration!.apiKeyHint : null,
    keyVersion: configured ? configuration!.keyVersion : 0,
    // 保留响应字段以兼容旧客户端；统一凭证不再做本地权限裁剪。
    permissions: configured ? answerBitOperations : [],
    lastCheckedAt: configuration?.lastCheckedAt ?? null,
    lastSyncedAt: configuration?.lastSyncedAt ?? null,
    updatedAt: configuration?.updatedAt ?? null,
    operations: answerBitOperations,
    brands,
    summary: {
      brandCount: brands.length,
      assignedBrandCount: brands.filter((brand) => brand.organizationId).length,
      availableBrandCount: brands.filter((brand) => !brand.organizationId)
        .length,
    },
  };
}

// @project-doc docs/interfaces/answerbit_integration.md#shared_credential_model
export const platformAnswerbitService = {
  async get(userId: string) {
    await requirePlatformPermission(userId, "platform.answerbit.read", {
      allowBeforeTencentConnection: true,
    });
    return publicConfiguration();
  },

  async getBrand(brandId: string, userId: string, _requestId: string) {
    // @project-doc docs/domains/identity_and_access.md#workspace_directory
    await requirePlatformPermission(userId, "platform.answerbit.read");
    const brand = await repository.findBrand(brandId);
    if (!brand)
      throw new ApiError(
        404,
        "ANSWERBIT_BRAND_NOT_FOUND",
        "腾讯品牌不在平台目录中",
      );
    return brand;
  },

  async createBrand(
    input: AdminCreateAnswerBitBrandInput,
    userId: string,
    audit: AuditContext,
  ) {
    await requirePlatformPermission(userId, "platform.tenant.manage");
    const configuration = await repository.getConfiguration();
    if (!configuration?.teamId || configuration.status !== "active")
      throw new ApiError(
        422,
        "ANSWERBIT_PLATFORM_CREDENTIAL_REQUIRED",
        "请先配置并验证平台统一 TeamID 与 API Key",
      );

    let result: { id: string };
    let createOperation = "/geo/brand/create";
    try {
      const apiKey = getSecretCipher().decrypt(
        configuration.encryptedApiKey,
        platformAnswerBitCredentialAad,
      );
      if (input.initialPrompts.length || input.competitors.length) {
        createOperation = "/geo/brand/bundle/create";
        const bundle = await createAnswerBitBrandBundle(
          apiKey,
          {
            team_id: configuration.teamId,
            brand: {
              brand_name: input.brand,
              alias: input.alias || undefined,
              website: input.website || undefined,
              description: input.description || undefined,
              note: input.note || undefined,
              icon_mime_type: input.iconMimeType,
              icon_data: input.iconData,
            },
            user_prompts: input.initialPrompts.map((question) => ({
              question,
            })),
            competitors: input.competitors.map((competitor) => ({
              name: competitor.name,
              alias: competitor.alias || undefined,
              description: competitor.description || undefined,
              website: competitor.website || undefined,
            })),
          },
          audit.requestId,
        );
        result = { id: bundle.brand.id };
      } else {
        result = await createAnswerBitBrand(
          apiKey,
          {
            team_id: configuration.teamId,
            brand: input.brand,
            alias: input.alias,
            website: input.website,
            description: input.description,
            note: input.note,
            icon_mime_type: input.iconMimeType,
            icon_data: input.iconData,
          },
          audit.requestId,
        );
      }
    } catch (error) {
      return mapUpstreamError(error);
    }

    let projection;
    try {
      projection = await syncTencentEnterpriseDirectory({
        brands: [{ id: result.id, name: input.brand }],
        teamId: configuration.teamId,
        apiKeyHint: configuration.apiKeyHint,
        actorUserId: userId,
        checkedAt: new Date(),
        expectedKeyVersion: configuration.keyVersion,
        completeDirectory: false,
      });
    } catch {
      await repository.markConfigurationInvalid(
        configuration.teamId,
        new Date(),
        "TENCENT_ENTERPRISE_PROJECTION_FAILED",
      );
      await writeAudit(audit, {
        operation: "platform.answerbit.brand.create",
        resourceType: "answerbit_brand",
        resourceId: result.id,
        result: "failed",
        summary: `腾讯品牌 ${input.brand}（${result.id}）已创建，但平台企业投影创建失败`,
      });
      throw new ApiError(
        500,
        "TENCENT_ENTERPRISE_PROJECTION_FAILED",
        "腾讯品牌已创建，但平台企业投影创建失败；请在腾讯接入重新验证统一配置",
        { brandId: result.id },
      );
    }
    if (projection.skipped)
      throw new ApiError(
        409,
        "ANSWERBIT_CONFIGURATION_CHANGED",
        "统一腾讯配置已发生变化，请确认企业目录后重试",
      );
    const organization = projection.organizations[0];
    const catalogBrand = await repository.updateBrandProjection({
      brandId: result.id,
      brandName: input.brand,
      brandAlias: input.alias,
      website: input.website,
      description: input.description,
      note: input.note,
      websiteAutoTrace: false,
      syncedAt: new Date(),
    });
    await writeAudit(audit, {
      operation: "platform.answerbit.brand.create",
      resourceType: "answerbit_brand",
      resourceId: result.id,
      summary: `通过腾讯 ${createOperation} 创建品牌 ${input.brand}（${result.id}），并创建平台企业 ${organization?.id}`,
    });
    return {
      ...catalogBrand,
      organizationId: catalogBrand?.organizationId ?? organization?.id ?? null,
      organizationName:
        catalogBrand?.organizationName ?? organization?.name ?? null,
      initializedPromptCount: input.initialPrompts.length,
      initializedCompetitorCount: input.competitors.length,
    };
  },

  async updateBrand(
    brandId: string,
    input: AdminUpdateAnswerBitBrandInput,
    userId: string,
    audit: AuditContext,
  ) {
    await requirePlatformPermission(userId, "platform.tenant.manage");
    const [configuration, brand] = await Promise.all([
      repository.getConfiguration(),
      repository.findBrand(brandId),
    ]);
    if (!configuration?.teamId || configuration.status !== "active")
      throw new ApiError(
        422,
        "ANSWERBIT_PLATFORM_CREDENTIAL_REQUIRED",
        "请先配置并验证平台统一 TeamID 与 API Key",
      );
    if (!brand?.organizationId)
      throw new ApiError(
        404,
        "TENCENT_ENTERPRISE_NOT_FOUND",
        "腾讯企业不存在或尚未完成平台投影",
      );
    try {
      const apiKey = getSecretCipher().decrypt(
        configuration.encryptedApiKey,
        platformAnswerBitCredentialAad,
      );
      const current = await getAnswerBitBrandDetail(
        apiKey,
        brandId,
        audit.requestId,
      );
      if (current.belong_team_id !== configuration.teamId)
        throw new ApiError(
          409,
          "ANSWERBIT_TEAM_SCOPE_MISMATCH",
          "腾讯品牌不属于平台固定 TeamID",
        );
      await updateAnswerBitBrand(
        apiKey,
        buildBrandUpdatePayload({
          brandId,
          brandName: input.brandName,
          brandAlias: input.brandAlias,
          website: input.website,
          description: input.description,
          note: input.note,
          websiteAutoTrace: input.websiteAutoTrace,
          defaultLanguage: current.default_language,
          shopKeyWords: current.shop_key_words,
        }),
        audit.requestId,
      );
    } catch (error) {
      return mapUpstreamError(error);
    }
    const updated = await repository.updateBrandProjection({
      brandId,
      ...input,
      syncedAt: new Date(),
    });
    await writeAudit(
      { ...audit, organizationId: brand.organizationId },
      {
        operation: "platform.answerbit.brand.update",
        resourceType: "answerbit_brand",
        resourceId: brandId,
        summary: `通过腾讯 /geo/brand/update 修改腾讯企业 ${input.brandName}（${brandId}）`,
      },
    );
    return updated;
  },

  async updateBrandIcon(
    brandId: string,
    input: AdminUpdateAnswerBitBrandIconInput,
    userId: string,
    audit: AuditContext,
  ) {
    await requirePlatformPermission(userId, "platform.tenant.manage");
    const [configuration, brand] = await Promise.all([
      repository.getConfiguration(),
      repository.findBrand(brandId),
    ]);
    if (!configuration?.teamId || configuration.status !== "active")
      throw new ApiError(
        422,
        "ANSWERBIT_PLATFORM_CREDENTIAL_REQUIRED",
        "请先配置并验证平台统一 TeamID 与 API Key",
      );
    if (!brand?.organizationId)
      throw new ApiError(
        404,
        "TENCENT_ENTERPRISE_NOT_FOUND",
        "腾讯企业不存在或尚未完成平台投影",
      );
    let result: { icon_url: string };
    try {
      result = await updateAnswerBitBrandIcon(
        getSecretCipher().decrypt(
          configuration.encryptedApiKey,
          platformAnswerBitCredentialAad,
        ),
        {
          brand_id: brandId,
          mime_type: input.iconMimeType,
          data: input.iconData,
        },
        audit.requestId,
      );
    } catch (error) {
      return mapUpstreamError(error);
    }
    await writeAudit(
      { ...audit, organizationId: brand.organizationId },
      {
        operation: "platform.answerbit.brand.icon.update",
        resourceType: "answerbit_brand",
        resourceId: brandId,
        summary: `通过腾讯 /geo/brand/update/icon 更新腾讯企业 ${brand.brandName}（${brandId}）Logo`,
      },
    );
    return { brandId, iconUrl: result.icon_url };
  },

  async deleteBrand(brandId: string, userId: string, audit: AuditContext) {
    await requirePlatformPermission(userId, "platform.tenant.manage");
    const [configuration, brand] = await Promise.all([
      repository.getConfiguration(),
      repository.findBrand(brandId),
    ]);
    if (!configuration?.teamId || configuration.status !== "active")
      throw new ApiError(
        422,
        "ANSWERBIT_PLATFORM_CREDENTIAL_REQUIRED",
        "请先配置并验证平台统一 TeamID 与 API Key",
      );
    if (!brand?.organizationId)
      throw new ApiError(
        404,
        "TENCENT_ENTERPRISE_NOT_FOUND",
        "腾讯企业不存在或尚未完成平台投影",
      );
    try {
      await deleteAnswerBitBrand(
        getSecretCipher().decrypt(
          configuration.encryptedApiKey,
          platformAnswerBitCredentialAad,
        ),
        brandId,
        audit.requestId,
      );
    } catch (error) {
      return mapUpstreamError(error);
    }
    await repository.closeBrandProjection(brandId, new Date());
    await writeAudit(
      { ...audit, organizationId: brand.organizationId },
      {
        operation: "platform.answerbit.brand.delete",
        resourceType: "answerbit_brand",
        resourceId: brandId,
        summary: `通过腾讯 /geo/brand/delete 删除腾讯企业 ${brand.brandName}（${brandId}），关闭平台企业投影`,
      },
    );
  },

  async getForTenant(organizationId: string, userId: string) {
    await organizationService.authorize(
      organizationId,
      userId,
      "answerbit.connection.read",
    );
    const configuration = await repository.getConfiguration();
    const [bindingCount, brand] = await Promise.all([
      repository.countOrganizationTeams(organizationId, configuration?.teamId),
      repository.findBrandByOrganization(organizationId),
    ]);
    const configured = Boolean(
      configuration?.teamId && bindingCount > 0 && brand,
    );
    return {
      configured,
      status: configured ? configuration!.status : ("missing" as const),
      credentialCount: configured ? 1 : 0,
      activeCredentialCount:
        configured && configuration!.status === "active" ? 1 : 0,
      enterpriseConnected: configured,
      brand: brand ?? null,
      lastCheckedAt: configuration?.lastCheckedAt ?? null,
      lastSyncedAt: configuration?.lastSyncedAt ?? null,
      updatedAt: configuration?.updatedAt ?? null,
    };
  },

  async synchronizeEnterprises(userId: string, audit: AuditContext) {
    await requirePlatformPermission(userId, "platform.tenant.manage");
    const configuration = await repository.getConfiguration();
    if (!configuration?.teamId || configuration.status !== "active")
      throw new ApiError(
        422,
        "ANSWERBIT_PLATFORM_CREDENTIAL_REQUIRED",
        "请先配置并验证平台统一 TeamID 与 API Key",
      );

    let brands: { id: string; name: string }[];
    try {
      brands = await queryBrands(
        getSecretCipher().decrypt(
          configuration.encryptedApiKey,
          platformAnswerBitCredentialAad,
        ),
        configuration.teamId,
        audit.requestId,
      );
    } catch (error) {
      return mapUpstreamError(error);
    }
    const checkedAt = new Date();
    const result = await syncTencentEnterpriseDirectory({
      brands,
      teamId: configuration.teamId,
      apiKeyHint: configuration.apiKeyHint,
      actorUserId: userId,
      checkedAt,
      expectedKeyVersion: configuration.keyVersion,
      completeDirectory: true,
    });
    if (result.skipped)
      throw new ApiError(
        409,
        "ANSWERBIT_CONFIGURATION_CHANGED",
        "统一腾讯配置已发生变化，请重新同步",
      );
    await writeAudit(audit, {
      operation: "platform.answerbit.enterprise.sync.manual",
      resourceType: "platform_answerbit_credential",
      resourceId: "1",
      summary: `手动同步腾讯企业：目录 ${brands.length} 家、新增 ${result.createdEnterpriseCount} 家、更新 ${result.updatedEnterpriseCount} 家、关闭 ${result.closedEnterpriseCount} 家`,
    });
    return {
      brandCount: brands.length,
      createdEnterpriseCount: result.createdEnterpriseCount,
      updatedEnterpriseCount: result.updatedEnterpriseCount,
      closedEnterpriseCount: result.closedEnterpriseCount,
      pendingMissingCount: result.pendingMissingCount,
      syncedAt: checkedAt,
    };
  },

  async configure(
    input: AdminSetAnswerBitCredentialInput,
    userId: string,
    audit: AuditContext,
  ) {
    await requirePlatformPermission(userId, "platform.tenant.manage", {
      allowBeforeTencentConnection: true,
    });
    const supportedOperations = [...answerBitOperations];
    const current = await repository.getConfiguration();
    if (current?.teamId && current.teamId !== input.teamId)
      throw new ApiError(
        409,
        "ANSWERBIT_TEAM_ID_LOCKED",
        "平台 TeamID 首次配置后固定，不能再修改",
      );

    let brands: { id: string; name: string }[];
    try {
      brands = await queryBrands(input.apiKey, input.teamId, audit.requestId);
    } catch (error) {
      if (error instanceof AnswerBitError)
        throw new ApiError(
          422,
          "ANSWERBIT_CONFIGURATION_INVALID",
          "TeamID 或 API Key 的腾讯接口校验未通过",
        );
      throw error;
    }

    const checkedAt = new Date();
    const cipher = getSecretCipher();
    let savedConfiguration;
    try {
      savedConfiguration = await repository.upsertConfiguration({
        teamId: input.teamId,
        permissions: supportedOperations,
        encryptedApiKey: cipher.encrypt(
          input.apiKey,
          platformAnswerBitCredentialAad,
        ),
        apiKeyFingerprint: cipher.fingerprint(input.apiKey),
        apiKeyHint: maskSecret(input.apiKey),
        userId,
        checkedAt,
      });
    } catch (error) {
      await repository.markConfigurationInvalid(
        input.teamId,
        checkedAt,
        "ANSWERBIT_CONFIGURATION_PERSIST_FAILED",
      );
      throw error;
    }
    let enterpriseSync;
    try {
      enterpriseSync = await syncTencentEnterpriseDirectory({
        brands,
        teamId: input.teamId,
        apiKeyHint: maskSecret(input.apiKey),
        actorUserId: userId,
        checkedAt,
        expectedKeyVersion: savedConfiguration.keyVersion,
        completeDirectory: true,
      });
    } catch {
      await repository.markConfigurationInvalid(
        input.teamId,
        checkedAt,
        "TENCENT_ENTERPRISE_PROJECTION_FAILED",
      );
      await writeAudit(audit, {
        operation: "platform.answerbit.enterprise.import",
        resourceType: "platform_answerbit_credential",
        resourceId: "1",
        result: "failed",
        summary: `固定 TeamID ${input.teamId} 的腾讯配置已保存，但企业投影导入失败`,
      });
      throw new ApiError(
        500,
        "TENCENT_ENTERPRISE_PROJECTION_FAILED",
        "腾讯配置已保存，但平台企业导入失败，请重新验证统一配置",
      );
    }
    if (enterpriseSync.skipped)
      throw new ApiError(
        409,
        "ANSWERBIT_CONFIGURATION_CHANGED",
        "统一腾讯配置已发生变化，请重新提交并验证",
      );
    await writeAudit(audit, {
      operation: "platform.answerbit.configure",
      resourceType: "platform_answerbit_credential",
      resourceId: "1",
      summary: `配置固定 TeamID ${input.teamId} 的统一 Key，系统直接接入 ${supportedOperations.length} 项 OpenAPI，导入腾讯企业 ${enterpriseSync.enterpriseCount} 家（新建 ${enterpriseSync.createdEnterpriseCount} 家）`,
    });
    return publicConfiguration();
  },

  async ensureOrganizationConnection(
    _organizationId: string,
    _actorUserId: string,
  ) {
    void _organizationId;
    void _actorUserId;
    throw new ApiError(
      403,
      "ANSWERBIT_PLATFORM_CREDENTIAL_REQUIRED",
      "TeamID 与 API Key 由平台统一配置，企业只绑定腾讯品牌",
    );
  },

  async markTeamVerified(connectionId: string) {
    await repository.updateConnectionHealth(connectionId, "active", new Date());
  },
};
