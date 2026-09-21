import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getBalance: vi.fn(),
  listMedia: vi.fn(),
  listMediaFields: vi.fn(),
  orderInfo: vi.fn(),
  getConfiguration: vi.fn(),
  upsertConfiguration: vi.fn(),
  requirePlatformPermission: vi.fn(),
  writeAudit: vi.fn(),
  encrypt: vi.fn(),
  fingerprint: vi.fn(),
  invalidateCache: vi.fn(),
  refreshChannels: vi.fn(),
}));

vi.mock("@geo/publication", async () => {
  const actual =
    await vi.importActual<typeof import("@geo/publication")>(
      "@geo/publication",
    );
  return {
    ...actual,
    FrogPublicationClient: class {
      getBalance = m.getBalance;
      listMedia = m.listMedia;
      listMediaFields = m.listMediaFields;
      orderInfo = m.orderInfo;
    },
  };
});
vi.mock("@/server/repositories/platform-frog", () => ({
  platformFrogRepository: {
    getConfiguration: m.getConfiguration,
    upsertConfiguration: m.upsertConfiguration,
  },
}));
vi.mock("@/server/permissions/platform", () => ({
  requirePlatformPermission: m.requirePlatformPermission,
}));
vi.mock("@/server/audit/write-audit", () => ({ writeAudit: m.writeAudit }));
vi.mock("@/server/security/secret-cipher", () => ({
  maskApiKey: () => "frog********1234",
  getSecretCipher: () => ({
    encrypt: m.encrypt,
    fingerprint: m.fingerprint,
  }),
}));
vi.mock("@/server/services/publications", () => ({
  invalidateFrogPublicationCache: m.invalidateCache,
  refreshFrogChannels: m.refreshChannels,
}));
vi.mock("@/server/http/errors", () => ({
  ApiError: class extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/server/env", () => ({
  getServerEnv: () => ({
    FROG_PUBLICATION_BASE_URL: "https://frog.example",
    FROG_PUBLICATION_API_KEY: "",
  }),
}));

import { platformFrogService } from "./platform-frog";

beforeEach(() => {
  vi.resetAllMocks();
  m.getBalance.mockResolvedValue({ money: "10.00", power_count: 8 });
  m.listMedia.mockResolvedValue([{ resource_id: "1" }]);
  m.listMediaFields.mockResolvedValue([{ field_id: "1" }]);
  m.orderInfo.mockResolvedValue([]);
  m.encrypt.mockReturnValue("ciphertext");
  m.fingerprint.mockReturnValue("fingerprint");
  m.upsertConfiguration.mockResolvedValue({
    id: 1,
    baseUrl: "https://frog.example",
    apiKeyHint: "frog********1234",
    keyVersion: 1,
    status: "active",
    lastCheckedAt: new Date("2026-09-19T00:00:00Z"),
    updatedAt: new Date("2026-09-19T00:00:00Z"),
  });
  m.getConfiguration.mockResolvedValue({
    baseUrl: "https://frog.example",
    apiKeyHint: "frog********1234",
    keyVersion: 1,
    status: "active",
    lastCheckedAt: new Date("2026-09-19T00:00:00Z"),
    updatedAt: new Date("2026-09-19T00:00:00Z"),
  });
});

describe("小青蛙网页配置", () => {
  it("先验证 Key，再加密保存且只返回掩码", async () => {
    const result = await platformFrogService.configure(
      { baseUrl: "https://frog.example", apiKey: "frog-secret-1234" },
      "user",
      { actorUserId: "user", requestId: "request" },
    );
    expect(m.getBalance).toHaveBeenCalledTimes(1);
    expect(m.listMedia).toHaveBeenCalledWith("website", 1, 1);
    expect(m.listMedia).toHaveBeenCalledWith("wemedia", 1, 1);
    expect(m.listMediaFields).toHaveBeenCalledWith("website");
    expect(m.listMediaFields).toHaveBeenCalledWith("wemedia");
    expect(m.orderInfo).toHaveBeenCalledWith("website", ["0"]);
    expect(m.orderInfo).toHaveBeenCalledWith("wemedia", ["0"]);
    expect(m.encrypt).toHaveBeenCalledWith(
      "frog-secret-1234",
      "platform-frog-publication",
    );
    expect(m.upsertConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ encryptedApiKey: "ciphertext" }),
    );
    expect(m.invalidateCache).toHaveBeenCalledTimes(1);
    expect(m.refreshChannels).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      configured: true,
      source: "database",
      apiKeyHint: "frog********1234",
      verification: expect.objectContaining({
        balance: true,
        websiteMedia: true,
        websiteFields: true,
        websiteOrders: true,
        wemediaMedia: true,
        wemediaFields: true,
        wemediaOrders: true,
        powerCount: 8,
      }),
    });
    expect(result).not.toHaveProperty("apiKey");
    expect(result).not.toHaveProperty("encryptedApiKey");
  });

  it("任一安全读取接口失败时不保存配置", async () => {
    m.listMedia.mockRejectedValueOnce(
      new (await import("@geo/publication")).FrogPublicationError(
        "business",
        "media_list",
        "rejected",
      ),
    );

    await expect(
      platformFrogService.configure(
        { baseUrl: "https://frog.example", apiKey: "frog-secret-1234" },
        "user",
        { actorUserId: "user", requestId: "request" },
      ),
    ).rejects.toMatchObject({ code: "FROG_CONFIGURATION_INVALID" });
    expect(m.upsertConfiguration).not.toHaveBeenCalled();
  });
});
