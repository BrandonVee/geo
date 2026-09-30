import { describe, expect, it } from "vitest";
import { validateEnterpriseAccess } from "./enterprise-access";
const now = new Date("2026-10-01T00:00:00Z");
const future = new Date("2027-01-01T00:00:00Z");
describe("企业有效期优先", () => {
  it("到期时刻即冻结，即使积分仍有效", () => {
    expect(() =>
      validateEnterpriseAccess(
        { status: "active", serviceExpiresAt: now, pointsExpiresAt: future },
        true,
        now,
      ),
    ).toThrow("企业服务已到期");
  });
  it("积分到期只阻止积分功能，人民币业务仍受企业期限制", () => {
    expect(() =>
      validateEnterpriseAccess(
        { status: "active", serviceExpiresAt: future, pointsExpiresAt: now },
        true,
        now,
      ),
    ).toThrow("积分有效期");
    expect(() =>
      validateEnterpriseAccess(
        { status: "active", serviceExpiresAt: future, pointsExpiresAt: now },
        false,
        now,
      ),
    ).not.toThrow();
  });
  it("续企业不会绕过积分到期；人工冻结不会被未来日期覆盖", () => {
    expect(() =>
      validateEnterpriseAccess(
        {
          status: "suspended",
          serviceExpiresAt: future,
          pointsExpiresAt: future,
        },
        true,
        now,
      ),
    ).toThrow("被冻结");
    expect(() =>
      validateEnterpriseAccess(
        { status: "active", serviceExpiresAt: future, pointsExpiresAt: future },
        true,
        now,
      ),
    ).not.toThrow();
  });
  it("未设置期限的历史企业兼容", () => {
    expect(() =>
      validateEnterpriseAccess({ status: "active" }, true, now),
    ).not.toThrow();
  });
});
