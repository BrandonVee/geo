import type {
  AdminCreateAnswerBitCredentialInput,
  AdminUpdateAnswerBitCredentialInput,
} from "@geo/contracts";
import {
  answerBitOperations,
  isAnswerBitOperation,
  maskSecret,
} from "@geo/core";
import type { AuditContext } from "@/server/audit/write-audit";
import { writeAudit } from "@/server/audit/write-audit";
import { ApiError, databaseErrorCode } from "@/server/http/errors";
import { requirePlatformPermission } from "@/server/permissions/platform";
import { answerBitCredentialRepository as repository } from "@/server/repositories/answerbit-credentials";
import { getSecretCipher } from "@/server/security/secret-cipher";
import { assertEntitlementCapacity } from "./billing";

const validatePermissions = (permissions: string[]) => {
  const unique = [...new Set(permissions)];
  const unknown = unique.filter(
    (operation) => !isAnswerBitOperation(operation),
  );
  if (unknown.length)
    throw new ApiError(
      400,
      "ANSWERBIT_PERMISSION_UNKNOWN",
      "包含系统尚未接入的 AnswerBit OpenAPI 权限",
      { operations: unknown },
    );
  return unique;
};

const rejectLegacyCredentialWrite = () => {
  throw new ApiError(
    410,
    "ANSWERBIT_CREDENTIAL_MANAGEMENT_DEPRECATED",
    "请在腾讯接入中维护固定 TeamID 与统一 API Key",
  );
};

const publicCredential = (
  item: Awaited<ReturnType<typeof repository.list>>[number],
) => ({
  id: item.id,
  organizationId: item.organizationId,
  organizationName: item.organizationName,
  teamBindingId: item.teamBindingId,
  teamId: item.teamId,
  teamDisplayName: item.teamDisplayName,
  displayName: item.displayName,
  scopeType: item.scopeType,
  brandId: item.brandId,
  permissions: item.permissions.filter((operation) => operation !== "*"),
  legacyWildcard: item.permissions.includes("*"),
  priority: item.priority,
  status: item.status,
  apiKeyHint: item.apiKeyHint,
  keyVersion: item.keyVersion,
  lastCheckedAt: item.lastCheckedAt,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

export const answerBitCredentialService = {
  async list(userId: string) {
    await requirePlatformPermission(userId, "platform.answerbit.read");
    const credentials = await repository.list();
    return {
      credentials: credentials.map(publicCredential),
      operations: answerBitOperations,
      summary: {
        credentialCount: credentials.length,
        activeCredentialCount: credentials.filter(
          (item) => item.status === "active",
        ).length,
        organizationCount: new Set(
          credentials.map((item) => item.organizationId),
        ).size,
        teamCount: new Set(credentials.map((item) => item.teamBindingId)).size,
      },
    };
  },

  async create(
    input: AdminCreateAnswerBitCredentialInput,
    userId: string,
    audit: AuditContext,
  ) {
    await requirePlatformPermission(userId, "platform.tenant.manage");
    rejectLegacyCredentialWrite();
    if (!(await repository.organizationExists(input.organizationId)))
      throw new ApiError(404, "ORGANIZATION_NOT_FOUND", "企业不存在");
    const existingTeam = await repository.findTeamByExternalId(input.teamId);
    if (existingTeam && existingTeam.organizationId !== input.organizationId)
      throw new ApiError(
        409,
        "TEAM_BINDING_ASSIGNED",
        "该 TeamID 已绑定到其他企业",
      );
    if (
      input.scopeType === "brand" &&
      input.brandId &&
      (!existingTeam ||
        !(await repository.brandMappingExists(
          input.organizationId,
          existingTeam.id,
          input.brandId,
        )))
    )
      await assertEntitlementCapacity(input.organizationId, "brands");
    const permissions = validatePermissions(input.permissions);
    const cipher = getSecretCipher();
    try {
      const created = await repository.create({
        ...input,
        permissions,
        actorUserId: userId,
        encryptedApiKey: cipher.encrypt(input.apiKey, input.organizationId),
        apiKeyFingerprint: cipher.fingerprint(input.apiKey),
        apiKeyHint: maskSecret(input.apiKey),
      });
      const credential = await repository.findById(created.id);
      if (!credential) throw new Error("CREDENTIAL_CREATE_FAILED");
      await writeAudit(audit, {
        operation: "platform.answerbit.credential.create",
        resourceType: "answerbit_credential_assignment",
        resourceId: created.id,
        summary: `为 TeamID ${input.teamId} 创建${input.scopeType === "brand" ? `品牌 ${input.brandId}` : "团队"}级 Key，授权 ${permissions.length} 个接口`,
      });
      return publicCredential(credential);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "domainCode" in error &&
        error.domainCode === "TEAM_BINDING_ASSIGNED"
      )
        throw new ApiError(
          409,
          "TEAM_BINDING_ASSIGNED",
          "该 TeamID 已绑定到其他企业",
        );
      if (
        error &&
        typeof error === "object" &&
        "domainCode" in error &&
        error.domainCode === "ANSWERBIT_KEY_ASSIGNED"
      )
        throw new ApiError(
          409,
          "ANSWERBIT_KEY_ASSIGNED",
          "该 API Key 已分配给其他 TeamID",
        );
      if (databaseErrorCode(error) === "23505")
        throw new ApiError(
          409,
          "ANSWERBIT_KEY_EXISTS",
          "该 API Key 已在当前企业配置",
        );
      throw error;
    }
  },

  async update(
    credentialId: string,
    input: AdminUpdateAnswerBitCredentialInput,
    userId: string,
    audit: AuditContext,
  ) {
    await requirePlatformPermission(userId, "platform.tenant.manage");
    rejectLegacyCredentialWrite();
    const current = await repository.findById(credentialId);
    if (!current)
      throw new ApiError(
        404,
        "ANSWERBIT_CREDENTIAL_NOT_FOUND",
        "AnswerBit Key 不存在",
      );
    const cipher = getSecretCipher();
    try {
      await repository.update(credentialId, {
        ...input,
        ...(input.permissions
          ? { permissions: validatePermissions(input.permissions) }
          : {}),
        ...(input.apiKey
          ? {
              encryptedApiKey: cipher.encrypt(
                input.apiKey,
                current.organizationId,
              ),
              apiKeyFingerprint: cipher.fingerprint(input.apiKey),
              apiKeyHint: maskSecret(input.apiKey),
            }
          : {}),
      });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "domainCode" in error &&
        error.domainCode === "ANSWERBIT_KEY_ASSIGNED"
      )
        throw new ApiError(
          409,
          "ANSWERBIT_KEY_ASSIGNED",
          "该 API Key 已分配给其他 TeamID",
        );
      if (databaseErrorCode(error) === "23505")
        throw new ApiError(
          409,
          "ANSWERBIT_KEY_EXISTS",
          "该 API Key 已在当前企业配置",
        );
      throw error;
    }
    const updated = await repository.findById(credentialId);
    if (!updated) throw new Error("CREDENTIAL_UPDATE_FAILED");
    await writeAudit(
      { ...audit, organizationId: current.organizationId },
      {
        operation: "platform.answerbit.credential.update",
        resourceType: "answerbit_credential_assignment",
        resourceId: credentialId,
        summary: `更新 TeamID ${current.teamId} 的 Key 范围、权限或状态`,
      },
    );
    return publicCredential(updated);
  },

  async remove(credentialId: string, userId: string, audit: AuditContext) {
    await requirePlatformPermission(userId, "platform.tenant.manage");
    rejectLegacyCredentialWrite();
    const disabled = await repository.disable(credentialId);
    if (!disabled)
      throw new ApiError(
        404,
        "ANSWERBIT_CREDENTIAL_NOT_FOUND",
        "AnswerBit Key 不存在",
      );
    await writeAudit(
      { ...audit, organizationId: disabled.organizationId },
      {
        operation: "platform.answerbit.credential.disable",
        resourceType: "answerbit_credential_assignment",
        resourceId: credentialId,
        summary: `停用 TeamID ${disabled.teamId} 的 ${disabled.scopeType} 级 Key`,
      },
    );
  },
};
