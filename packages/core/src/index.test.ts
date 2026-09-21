import { describe, expect, it } from "vitest";
import {
  advanceTencentBrandMissingSync,
  answerBitAvailableCredits,
  answerBitApifoxOperations,
  answerBitCreditUtilization,
  answerBitMeteringOperations,
  answerBitOperations,
  billableFeatures,
  featureScopeAllowsPermission,
  hasPermission,
  isAnswerBitOperation,
  isBillableFeature,
  isAnswerBitMeteringOperation,
  isPlatformTencentReady,
  maskSecret,
  parseTencentBrandDirectory,
  organizationFeaturePermissions,
  organizationFeatures,
  permissions,
  recordsToCsv,
} from "./index";
describe("角色权限矩阵", () => {
  it("平台管理员拥有全部权限", () =>
    expect(hasPermission("super_admin", "platform.balance.manage")).toBe(true));
  it("企业管理员不能使用平台管理权限", () =>
    expect(hasPermission("tenant_admin", "platform.tenant.manage")).toBe(
      false,
    ));
  it("品牌编辑者可以编辑资源但不能删除", () => {
    expect(hasPermission("brand_editor", "resource.update")).toBe(true);
    expect(hasPermission("brand_editor", "resource.delete")).toBe(false);
  });
  it("只读用户只有读取权限", () => {
    expect(hasPermission("brand_viewer", "resource.read")).toBe(true);
    expect(hasPermission("brand_viewer", "resource.update")).toBe(false);
  });
  it("只有企业管理员和品牌管理员可以导出报表", () => {
    expect(hasPermission("tenant_admin", "report.export")).toBe(true);
    expect(hasPermission("brand_admin", "report.export")).toBe(true);
    expect(hasPermission("brand_editor", "report.export")).toBe(false);
  });
  it("企业管理员配置通知，品牌成员只能读取其品牌通知", () => {
    expect(hasPermission("tenant_admin", "notification.manage")).toBe(true);
    expect(hasPermission("brand_admin", "notification.manage")).toBe(false);
    expect(hasPermission("brand_viewer", "notification.read")).toBe(true);
  });
});
describe("企业功能范围", () => {
  it("功能 allowlist 会收窄角色权限但不影响其它模块", () => {
    expect(
      featureScopeAllowsPermission(["geo_insights"], "answerbit.resource.read"),
    ).toBe(true);
    expect(
      featureScopeAllowsPermission(["geo_insights"], "publication.create"),
    ).toBe(false);
  });
  it("覆盖每个企业权限且每个权限只归属一个功能", () => {
    const mapped = organizationFeatures.flatMap((feature) => [
      ...organizationFeaturePermissions[feature],
    ]);
    expect(new Set(mapped).size).toBe(mapped.length);
    expect(new Set(mapped)).toEqual(
      new Set(
        permissions.filter((permission) => !permission.startsWith("platform.")),
      ),
    );
  });
});
describe("CSV 导出", () => {
  it("转义引号、换行并阻断表格公式注入", () => {
    const value = recordsToCsv([{ query: "=SUM(1,1)", note: 'a"b\nline' }]);
    expect(value).toContain('"\'=SUM(1,1)"');
    expect(value).toContain('"a""b\nline"');
    expect(value.startsWith("\uFEFF")).toBe(true);
  });
});
describe("AnswerBit OpenAPI 权限目录", () => {
  it("按精确 operation 识别已接入接口", () => {
    expect(answerBitApifoxOperations).toHaveLength(48);
    expect(answerBitOperations).toContain("/geo/query/brand");
    expect(answerBitOperations).toContain("/geo/brand/bundle/create");
    expect(answerBitOperations).toContain("/geo/brand/update/icon");
    expect(answerBitOperations).toContain("/geo/billing/quota/purchase");
    expect(isAnswerBitOperation("/geo/article/create")).toBe(true);
    expect(isAnswerBitOperation("/geo/not-integrated")).toBe(false);
  });
  it("识别九个官方计量查询，并按官方字段计算可用积分", () => {
    expect(answerBitMeteringOperations).toHaveLength(9);
    expect(isAnswerBitMeteringOperation("/geo/billing/credit/status")).toBe(
      true,
    );
    expect(isAnswerBitMeteringOperation("/geo/article/create")).toBe(false);
    expect(answerBitAvailableCredits({ total_amount: 800 })).toBe(800);
    expect(
      answerBitCreditUtilization({ total_amount: 800, used_amount: 200 }),
    ).toBe(20);
  });
});
describe("腾讯功能计费", () => {
  it("只识别业务功能，不把 OpenAPI operation 当成计费项", () => {
    expect(isBillableFeature("ai_article_generation")).toBe(true);
    expect(isBillableFeature("/geo/article/create")).toBe(false);
    expect(billableFeatures.map((item) => item.code)).not.toContain(
      "extra_brand",
    );
    expect(billableFeatures.map((item) => item.code)).not.toContain(
      "extra_member",
    );
  });
});
describe("密钥掩码", () => {
  it("长密钥的掩码不超过数据库字段上限", () => {
    const hint = maskSecret(`sk-8${"x".repeat(35)}GLJP`);
    expect(hint).toHaveLength(32);
    expect(hint).toMatch(/^sk-8\*{24}GLJP$/);
  });
});
describe("平台腾讯接入就绪门禁", () => {
  it("只有固定 TeamID 与 active 状态同时存在才开放业务", () => {
    expect(isPlatformTencentReady({ teamId: "team-1", status: "active" })).toBe(
      true,
    );
    expect(isPlatformTencentReady({ teamId: null, status: "active" })).toBe(
      false,
    );
    expect(
      isPlatformTencentReady({ teamId: "team-1", status: "invalid" }),
    ).toBe(false);
    expect(isPlatformTencentReady(undefined)).toBe(false);
  });
});
describe("腾讯品牌目录解析", () => {
  it("规范化 BrandID 并按最后一条记录去重", () => {
    expect(
      parseTencentBrandDirectory([
        { id: 1001, brand_name: "旧名称" },
        { id: "1001", brand_name: "新名称", extra: true },
      ]),
    ).toEqual([{ id: "1001", name: "新名称" }]);
  });
  it("拒绝不完整的腾讯目录响应", () => {
    expect(() => parseTencentBrandDirectory([{ id: "brand-1" }])).toThrow(
      "INVALID_BRAND_DIRECTORY",
    );
  });
  it("连续两次完整目录缺失后才关闭企业投影", () => {
    expect(advanceTencentBrandMissingSync(0)).toEqual({
      missingSyncCount: 1,
      shouldClose: false,
    });
    expect(advanceTencentBrandMissingSync(1)).toEqual({
      missingSyncCount: 2,
      shouldClose: true,
    });
  });
});
