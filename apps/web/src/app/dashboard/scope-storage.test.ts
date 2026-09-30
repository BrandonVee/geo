import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readStoredBrandId,
  readStoredOrganizationId,
  readStoredScopeId,
  storeBrandId,
  storeOrganizationId,
  selectScopeId,
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
