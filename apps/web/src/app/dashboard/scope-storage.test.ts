import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readStoredBrandId,
  readStoredOrganizationId,
  readStoredScopeId,
  storeBrandId,
  storeOrganizationId,
  selectScopeId,
  scopedDashboardPath,
} from "./scope-storage";

const values = new Map<string, string>();

beforeEach(() => {
  values.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("dashboard scope persistence", () => {
  it("跳转范围保留目标页面参数与锚点，替换旧企业和品牌", () => {
    const path = scopedDashboardPath(
      "/dashboard/content?stage=tracking&organizationId=old&brandId=old-brand#directory",
      "enterprise-b",
      "brand-b",
    );
    const url = new URL(path, "https://example.com");
    expect(url.pathname).toBe("/dashboard/content");
    expect(url.searchParams.get("stage")).toBe("tracking");
    expect(url.searchParams.get("organizationId")).toBe("enterprise-b");
    expect(url.searchParams.get("brandId")).toBe("brand-b");
    expect(url.hash).toBe("#directory");
  });

  it("切换范围移除旧问题和发布来源，保留页面阶段", () => {
    const path = scopedDashboardPath(
      "/dashboard/content?stage=tracking&organizationId=old&brandId=old-brand&promptId=old-prompt&promptText=old-question&publicationOrderId=old-order",
      "enterprise-b",
      "brand-b",
    );
    const url = new URL(path, "https://example.com");
    expect(url.searchParams.get("stage")).toBe("tracking");
    for (const key of ["promptId", "promptText", "publicationOrderId"])
      expect(url.searchParams.has(key)).toBe(false);
    const same = scopedDashboardPath(
      "/dashboard/content?organizationId=enterprise-b&brandId=brand-b&promptId=current-prompt",
      "enterprise-b",
      "brand-b",
    );
    expect(
      new URL(same, "https://example.com").searchParams.get("promptId"),
    ).toBe("current-prompt");
  });
  it("企业切换未取得新品牌前不携带旧品牌", () => {
    expect(
      scopedDashboardPath(
        "/dashboard/answers?brandId=old-brand&q=keyword",
        "enterprise-b",
      ),
    ).toBe("/dashboard/answers?q=keyword&organizationId=enterprise-b");
  });
  it("订单切换企业清除原范围条件，同范围刷新保留条件", () => {
    const path =
      "/dashboard/publication/orders?organizationId=a&brandId=brand-a&keyword=old-order&page=2&stage=history";
    const keys = ["keyword", "page"];
    const next = new URL(
      scopedDashboardPath(path, "b", undefined, keys),
      "https://example.com",
    );
    expect(next.searchParams.has("keyword")).toBe(false);
    expect(next.searchParams.has("page")).toBe(false);
    expect(next.searchParams.get("stage")).toBe("history");
    const same = new URL(
      scopedDashboardPath(path, "a", "brand-a", keys),
      "https://example.com",
    );
    expect(same.searchParams.get("keyword")).toBe("old-order");
    expect(same.searchParams.get("page")).toBe("2");
  });

  it("尚未选择企业时保留目标路径", () => {
    expect(scopedDashboardPath("/dashboard/notifications", "")).toBe(
      "/dashboard/notifications",
    );
  });

  it("明确的跳转范围优先于浏览器记忆，并拒绝无权限的范围", () => {
    expect(
      selectScopeId("enterprise-a", "enterprise-b", [
        "enterprise-a",
        "enterprise-b",
      ]),
    ).toBe("enterprise-a");
    expect(
      selectScopeId("unknown", "enterprise-b", [
        "enterprise-a",
        "enterprise-b",
      ]),
    ).toBe("enterprise-b");
    expect(selectScopeId("unknown", "missing", ["enterprise-a"])).toBe(
      "enterprise-a",
    );
  });
  it("浏览器禁止存储时仍可选择企业", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    expect(readStoredOrganizationId(["organization-1"])).toBe("");
    expect(() => storeOrganizationId("organization-1")).not.toThrow();
  });
  it("returns only a stored id that is still available", () => {
    values.set("scope", "team-2");

    expect(readStoredScopeId("scope", ["team-1", "team-2"])).toBe("team-2");
    expect(readStoredScopeId("scope", ["team-1"])).toBe("");
  });

  it("restores an organization only while the user can still access it", () => {
    storeOrganizationId("organization-2");

    expect(readStoredOrganizationId(["organization-1", "organization-2"])).toBe(
      "organization-2",
    );
    expect(readStoredOrganizationId(["organization-1"])).toBe("");
  });

  it("isolates brand selections by organization", () => {
    storeBrandId("organization-1", "brand-1");
    storeBrandId("organization-2", "brand-2");

    expect(readStoredBrandId("organization-1", ["brand-1", "brand-2"])).toBe(
      "brand-1",
    );
    expect(readStoredBrandId("organization-2", ["brand-1", "brand-2"])).toBe(
      "brand-2",
    );
  });
});
