import {
  platformAnswerBitCredentialAad,
  type AnswerBitOperation,
} from "@geo/core";
import { ApiError } from "@/server/http/errors";
import { answerBitCredentialRepository } from "@/server/repositories/answerbit-credentials";
import { brandRepository } from "@/server/repositories/brands";
import { platformAnswerbitRepository } from "@/server/repositories/platform-answerbit";
import { getSecretCipher } from "@/server/security/secret-cipher";

export type AnswerBitCredentialSource = {
  organizationId: string;
  teamBindingId: string;
};

// @project-doc docs/interfaces/answerbit_integration.md#credential_resolution
export async function resolveAnswerBitCredential(
  source: AnswerBitCredentialSource,
  operation: AnswerBitOperation,
  brandId?: string,
) {
  const shared = await platformAnswerbitRepository.getConfiguration();
  if (shared?.teamId) {
    if (shared.status !== "active")
      throw new ApiError(
        422,
        "ANSWERBIT_KEY_NOT_CONFIGURED",
        "平台统一 AnswerBit API Key 当前不可用",
      );
    const team = await brandRepository.findTeam(
      source.organizationId,
      source.teamBindingId,
    );
    if (!team || team.teamId !== shared.teamId)
      throw new ApiError(
        403,
        "ANSWERBIT_TEAM_SCOPE_MISMATCH",
        "企业未绑定平台固定 TeamID",
      );
    if (
      brandId &&
      !(await brandRepository.findBrand(
        source.organizationId,
        source.teamBindingId,
        brandId,
      ))
    )
      throw new ApiError(
        403,
        "ANSWERBIT_KEY_SCOPE_MISMATCH",
        "腾讯品牌不属于当前企业",
      );
    return {
      assignment: shared,
      connectionId: team.connectionId,
      apiKey: getSecretCipher().decrypt(
        shared.encryptedApiKey,
        platformAnswerBitCredentialAad,
      ),
    };
  }

  const credentials = await answerBitCredentialRepository.listForTeam(
    source.organizationId,
    source.teamBindingId,
  );
  if (!credentials.length)
    throw new ApiError(
      422,
      "ANSWERBIT_KEY_NOT_CONFIGURED",
      "该 TeamID 尚未配置 AnswerBit API Key",
    );

  const active = credentials.filter((item) => item.status === "active");
  if (!active.length)
    throw new ApiError(
      422,
      "ANSWERBIT_KEY_NOT_CONFIGURED",
      "该 TeamID 的 AnswerBit API Key 已停用",
    );

  const scoped = active.filter((item) =>
    brandId
      ? item.scopeType === "team" ||
        (item.scopeType === "brand" && item.brandId === brandId)
      : item.scopeType === "team",
  );
  if (!scoped.length)
    throw new ApiError(
      403,
      "ANSWERBIT_KEY_SCOPE_MISMATCH",
      brandId
        ? "没有覆盖该品牌的 AnswerBit API Key"
        : "当前操作需要团队级 AnswerBit API Key",
    );

  const permitted = scoped.filter(
    (item) =>
      item.permissions.includes(operation) || item.permissions.includes("*"),
  );
  if (!permitted.length)
    throw new ApiError(
      403,
      "ANSWERBIT_KEY_PERMISSION_DENIED",
      `当前 Key 未授权调用 ${operation}`,
    );

  permitted.sort((left, right) => {
    const leftExact = left.scopeType === "brand" ? 0 : 1;
    const rightExact = right.scopeType === "brand" ? 0 : 1;
    return (
      leftExact - rightExact ||
      left.priority - right.priority ||
      right.updatedAt.getTime() - left.updatedAt.getTime()
    );
  });
  const selected = permitted[0];
  return {
    assignment: selected,
    connectionId: selected.connectionId,
    apiKey: getSecretCipher().decrypt(
      selected.encryptedApiKey,
      source.organizationId,
    ),
  };
}
