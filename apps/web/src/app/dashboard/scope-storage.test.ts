import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readStoredBrandId,
  readStoredOrganizationId,
  readStoredScopeId,
  storeBrandId,
  storeOrganizationId,
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
