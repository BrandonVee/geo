import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createBrand: vi.fn(),
  createBrandBundle: vi.fn(),
  syncTencentEnterpriseDirectory: vi.fn(),
  updateBrandIcon: vi.fn(),
  updateBrandProjection: vi.fn(),
  writeAudit: vi.fn(),
  findBrand: vi.fn(),
  getBrandDetail: vi.fn(),
  getConfiguration: vi.fn(),
  permission: vi.fn(),
}));

vi.mock("@geo/db", () => ({
  syncTencentEnterpriseDirectory: mocks.syncTencentEnterpriseDirectory,
}));
vi.mock("@/server/audit/write-audit", () => ({
  writeAudit: mocks.writeAudit,
}));
vi.mock("@/server/http/errors", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/server/integrations/answerbit/errors", () => ({
  AnswerBitError: class AnswerBitError extends Error {},
}));
vi.mock("@/server/integrations/answerbit/modules/brands", () => ({
  buildBrandUpdatePayload: vi.fn(),
  createBrand: mocks.createBrand,
  createBrandBundle: mocks.createBrandBundle,
  deleteBrand: vi.fn(),
  getBrandDetail: mocks.getBrandDetail,
  queryBrands: vi.fn(),
  updateBrand: vi.fn(),
  updateBrandIcon: mocks.updateBrandIcon,
}));
vi.mock("@/server/permissions/platform", () => ({
  requirePlatformPermission: mocks.permission,
}));
vi.mock("@/server/repositories/platform-answerbit", () => ({
  platformAnswerbitRepository: {
    findBrand: mocks.findBrand.mockResolvedValue({
      brandId: "brand-1",
      brandName: "腾讯品牌",
      organizationId: "organization-1",
    }),
    getConfiguration: mocks.getConfiguration.mockResolvedValue({
      teamId: "team-1",
      status: "active",
      encryptedApiKey: "ciphertext",
      apiKeyHint: "key****hint",
      keyVersion: 1,
    }),
    updateBrandProjection: mocks.updateBrandProjection,
  },
}));
vi.mock("@/server/security/secret-cipher", () => ({
  getSecretCipher: vi.fn().mockReturnValue({
    decrypt: vi.fn().mockReturnValue("api-key"),
  }),
}));
vi.mock("./answerbit-connections", () => ({
  mapUpstreamError: vi.fn((error: unknown) => {
    throw error;
  }),
}));
vi.mock("./organizations", () => ({ organizationService: {} }));

import { platformAnswerbitService } from "./platform-answerbit";

const audit = { requestId: "request-1", actorUserId: "user-1" };

describe("平台腾讯品牌业务编排", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.syncTencentEnterpriseDirectory.mockResolvedValue({
      skipped: false,
      organizations: [{ id: "organization-1", name: "腾讯品牌" }],
    });
    mocks.updateBrandProjection.mockResolvedValue({
      brandId: "brand-1",
      brandName: "腾讯品牌",
      organizationId: "organization-1",
      organizationName: "腾讯品牌",
    });
  });

  it("品牌详情读取本地资料，不访问腾讯或读取密钥配置", async () => {
    const brand = {
      brandId: "brand-1",
      brandName: "本地品牌",
      organizationId: "organization-1",
      alias: "别名",
      website: "https://example.test",
      description: "介绍",
      note: "备注",
      websiteAutoTrace: false,
    };
    mocks.findBrand.mockResolvedValueOnce(brand);
    mocks.getBrandDetail.mockRejectedValueOnce(
      new Error("upstream unavailable"),
    );
    expect(
      await platformAnswerbitService.getBrand("brand-1", "user-1", "request-1"),
    ).toEqual(brand);
    expect(mocks.permission).toHaveBeenCalledWith(
      "user-1",
      "platform.answerbit.read",
    );
    expect(mocks.getConfiguration).not.toHaveBeenCalled();
    expect(mocks.getBrandDetail).not.toHaveBeenCalled();
  });

  it("本地目录不存在或已关闭的品牌返回404", async () => {
    mocks.findBrand.mockResolvedValueOnce(undefined);
    await expect(
      platformAnswerbitService.getBrand("missing", "user-1", "request-1"),
    ).rejects.toMatchObject({ status: 404, code: "ANSWERBIT_BRAND_NOT_FOUND" });
    expect(mocks.getBrandDetail).not.toHaveBeenCalled();
  });

  it("没有管理权限时不读取本地品牌资料", async () => {
    mocks.permission.mockRejectedValueOnce(new Error("permission denied"));
    await expect(
      platformAnswerbitService.getBrand("brand-1", "user-1", "request-1"),
    ).rejects.toThrow("permission denied");
    expect(mocks.findBrand).not.toHaveBeenCalled();
  });

  it("存在初始化问题或竞品时使用固定 TeamID 调用 bundle 创建", async () => {
    mocks.createBrandBundle.mockResolvedValue({
      brand: { id: "brand-1", brand_name: "腾讯品牌" },
      prompts: [{ prompt_id: "prompt-1", question: "值得买吗" }],
      competitors: [{ competitor_id: "competitor-1", name: "竞品" }],
    });

    await expect(
      platformAnswerbitService.createBrand(
        {
          brand: "腾讯品牌",
          alias: "",
          website: "",
          description: "",
          note: "",
          initialPrompts: ["值得买吗"],
          competitors: [
            {
              name: "竞品",
              alias: "",
              description: "",
              website: "",
            },
          ],
        },
        "user-1",
        audit,
      ),
    ).resolves.toMatchObject({
      brandId: "brand-1",
      initializedPromptCount: 1,
      initializedCompetitorCount: 1,
    });
    expect(mocks.createBrand).not.toHaveBeenCalled();
    expect(mocks.createBrandBundle).toHaveBeenCalledWith(
      "api-key",
      expect.objectContaining({
        team_id: "team-1",
        brand: { brand_name: "腾讯品牌" },
        user_prompts: [{ question: "值得买吗" }],
        competitors: [{ name: "竞品" }],
      }),
      "request-1",
    );
  });

  it("Logo 更新使用独立腾讯 operation 并写入审计", async () => {
    mocks.updateBrandIcon.mockResolvedValue({
      icon_url: "https://static.test/logo.png",
    });
    await expect(
      platformAnswerbitService.updateBrandIcon(
        "brand-1",
        { iconMimeType: "image/png", iconData: "base64" },
        "user-1",
        audit,
      ),
    ).resolves.toEqual({
      brandId: "brand-1",
      iconUrl: "https://static.test/logo.png",
    });
    expect(mocks.updateBrandIcon).toHaveBeenCalledWith(
      "api-key",
      { brand_id: "brand-1", mime_type: "image/png", data: "base64" },
      "request-1",
    );
    expect(mocks.writeAudit).toHaveBeenCalled();
  });
});
