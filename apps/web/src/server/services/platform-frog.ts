import type { AdminSetFrogCredentialInput } from "@geo/contracts";
import { FrogPublicationClient, FrogPublicationError } from "@geo/publication";
import { platformFrogCredentialAad } from "@geo/core";
import type { AuditContext } from "@/server/audit/write-audit";
import { writeAudit } from "@/server/audit/write-audit";
import { getServerEnv } from "@/server/env";
import { ApiError } from "@/server/http/errors";
import {
  invalidateFrogPublicationCache,
  refreshFrogChannels,
} from "@/server/services/publications";
import { requirePlatformPermission } from "@/server/permissions/platform";
import { platformFrogRepository } from "@/server/repositories/platform-frog";
import { getSecretCipher, maskApiKey } from "@/server/security/secret-cipher";

async function publicConfiguration() {
  const configuration = await platformFrogRepository.getConfiguration();
  if (configuration)
    return {
      configured: configuration.status === "active",
      source: "database" as const,
      status: configuration.status,
      baseUrl: configuration.baseUrl,
      apiKeyHint: configuration.apiKeyHint,
      keyVersion: configuration.keyVersion,
      lastCheckedAt: configuration.lastCheckedAt,
      updatedAt: configuration.updatedAt,
    };
  const environment = getServerEnv();
  const configured = environment.FROG_PUBLICATION_API_KEY.length > 0;
  return {
    configured,
    source: configured ? ("environment" as const) : ("missing" as const),
    status: configured ? ("active" as const) : ("missing" as const),
    baseUrl: environment.FROG_PUBLICATION_BASE_URL,
    apiKeyHint: configured
      ? maskApiKey(environment.FROG_PUBLICATION_API_KEY)
      : null,
    keyVersion: 0,
    lastCheckedAt: null,
    updatedAt: null,
  };
}

async function verifyPublicationCapabilities(client: FrogPublicationClient) {
  const [
    balance,
    websiteMedia,
    websiteFields,
    websiteOrders,
    wemediaMedia,
    wemediaFields,
    wemediaOrders,
  ] = await Promise.all([
    client.getBalance(),
    client.listMedia("website", 1, 1),
    client.listMediaFields("website"),
    client.orderInfo("website", ["0"]),
    client.listMedia("wemedia", 1, 1),
    client.listMediaFields("wemedia"),
    client.orderInfo("wemedia", ["0"]),
  ]);
  return {
    balance: true as const,
    websiteMedia: true as const,
    websiteFields: true as const,
    websiteOrders: true as const,
    wemediaMedia: true as const,
    wemediaFields: true as const,
    wemediaOrders: true as const,
    websiteSampleCount: websiteMedia.length,
    websiteFieldCount: websiteFields.length,
    wemediaSampleCount: wemediaMedia.length,
    wemediaFieldCount: wemediaFields.length,
    websiteOrderProbeCount: websiteOrders.length,
    wemediaOrderProbeCount: wemediaOrders.length,
    powerCount: balance.power_count,
  };
}

export const platformFrogService = {
  async get(userId: string) {
    await requirePlatformPermission(userId, "platform.publication.manage");
    return publicConfiguration();
  },

  async configure(
    input: AdminSetFrogCredentialInput,
    userId: string,
    audit: AuditContext,
  ) {
    await requirePlatformPermission(userId, "platform.publication.manage");
    const client = new FrogPublicationClient(input.apiKey, input.baseUrl);
    let verification;
    try {
      verification = await verifyPublicationCapabilities(client);
    } catch (error) {
      if (error instanceof FrogPublicationError)
        throw new ApiError(
          422,
          "FROG_CONFIGURATION_INVALID",
          "小青蛙余额、媒体目录、分类或订单查询接口校验未通过",
        );
      throw error;
    }
    const checkedAt = new Date();
    const cipher = getSecretCipher();
    const configuration = await platformFrogRepository.upsertConfiguration({
      baseUrl: input.baseUrl,
      encryptedApiKey: cipher.encrypt(input.apiKey, platformFrogCredentialAad),
      apiKeyFingerprint: cipher.fingerprint(input.apiKey),
      apiKeyHint: maskApiKey(input.apiKey),
      userId,
      checkedAt,
    });
    invalidateFrogPublicationCache();
    // 完整媒体目录可能有数万条。保存配置只做轻量能力校验，目录抓取与
    // 写库转入后台，避免管理员页面一直等待并一次渲染大量数据。
    void refreshFrogChannels(client);
    await writeAudit(audit, {
      operation: "platform.frog.configuration.update",
      resourceType: "platform_frog_credential",
      resourceId: String(configuration.id),
      summary: `保存并验证小青蛙平台 Key（版本 ${configuration.keyVersion}）`,
    });
    return { ...(await publicConfiguration()), verification };
  },
};
