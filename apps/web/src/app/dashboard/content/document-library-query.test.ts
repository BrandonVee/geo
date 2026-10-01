import { describe, expect, it } from "vitest";

import {
  libraryResetQueryKeys,
  readDocumentLibraryQuery,
  writeDocumentLibraryQuery,
  type DocumentLibraryQuery,
} from "./document-library-query";

const scope = {
  organizationId: "8a332f51-d305-40be-8ddb-cb371d8cc741",
  teamBindingId: "3e1c2f5e-42f6-4c89-a942-0acb5e42042b",
  brandId: "brand-甲",
};
const folderId = "7123c37e-bd13-440d-b289-f17764c53521";
const defaultQuery: DocumentLibraryQuery = {
  q: "",
  folder: "all",
  status: "active",
  source: "all",
  page: 1,
};
const savedQuery: DocumentLibraryQuery = {
  q: "中文 draft & 100%",
  folder: folderId,
  status: "archived",
  source: "imported",
  page: 7,
};
const savedParams = () =>
  new URLSearchParams({
    libraryOrganizationId: scope.organizationId,
    libraryTeamBindingId: scope.teamBindingId,
    libraryBrandId: scope.brandId,
    libraryQ: savedQuery.q,
    libraryFolder: savedQuery.folder,
    libraryStatus: savedQuery.status,
    librarySource: savedQuery.source,
    libraryPage: String(savedQuery.page),
  });

describe("document library URL query", () => {
  it("restores all filters and the page only for the complete matching scope", () => {
    expect(readDocumentLibraryQuery(savedParams(), scope)).toEqual({
      query: savedQuery,
      invalid: false,
    });
    expect(readDocumentLibraryQuery(new URLSearchParams(), scope)).toEqual({
      query: defaultQuery,
      invalid: false,
    });
  });

  it.each(["libraryOrganizationId", "libraryTeamBindingId", "libraryBrandId"])(
    "ignores another scope or a missing %s marker",
    (marker) => {
      const params = savedParams();
      params.set(marker, "another-scope");
      expect(readDocumentLibraryQuery(params, scope)).toEqual({
        query: defaultQuery,
        invalid: false,
      });
      params.delete(marker);
      // Invalid values belonging to an old/unmarked scope are not current errors.
      params.set("libraryPage", "invalid-old-page");
      expect(readDocumentLibraryQuery(params, scope)).toEqual({
        query: defaultQuery,
        invalid: false,
      });
    },
  );

  it.each([
    ["libraryPage", "0"],
    ["libraryPage", "-1"],
    ["libraryPage", "1.5"],
    ["libraryPage", "5002"],
    ["libraryPage", "NaN"],
    ["libraryPage", "Infinity"],
    ["libraryPage", ""],
    ["libraryQ", "x".repeat(201)],
    ["libraryStatus", "deleted"],
    ["librarySource", "external"],
    ["libraryFolder", "missing-folder-id"],
  ])("resets the whole query and marks invalid %s=%s", (key, value) => {
    const params = savedParams();
    params.set(key, value);
    expect(readDocumentLibraryQuery(params, scope)).toEqual({
      query: defaultQuery,
      invalid: true,
    });
  });

  it("accepts the highest supported page, unfiled documents and normalized search text", () => {
    const params = savedParams();
    params.set("libraryPage", "5001");
    params.set("libraryFolder", "unfiled");
    params.set("libraryStatus", "ready");
    params.set("librarySource", "ai_generated");
    params.set("libraryQ", `  ${savedQuery.q}  `);
    expect(readDocumentLibraryQuery(params, scope)).toEqual({
      query: {
        q: savedQuery.q,
        folder: "unfiled",
        status: "ready",
        source: "ai_generated",
        page: 5001,
      },
      invalid: false,
    });
  });

  it.each<Partial<DocumentLibraryQuery>>([
    { q: "new search" },
    { folder: "unfiled" },
    { status: "draft" },
    { source: "manual" },
  ])("starts at page one after a filter change: %j", (patch) => {
    const params = writeDocumentLibraryQuery(
      savedParams(),
      scope,
      savedQuery,
      patch,
    );
    expect(readDocumentLibraryQuery(params, scope)).toEqual({
      query: { ...savedQuery, ...patch, page: 1 },
      invalid: false,
    });
    expect(params.has("libraryPage")).toBe(false);
  });

  it("retains filters when explicitly moving to a page", () => {
    const params = writeDocumentLibraryQuery(savedParams(), scope, savedQuery, {
      page: 3,
    });
    expect(readDocumentLibraryQuery(params, scope)).toEqual({
      query: { ...savedQuery, page: 3 },
      invalid: false,
    });
    expect(params.get("libraryPage")).toBe("3");
  });

  it("preserves unrelated URL fields and leaves the input untouched", () => {
    const original = savedParams();
    original.set("section", "library");
    original.set("tab", "documents");
    original.append("unrelated", "one");
    original.append("unrelated", "two");
    const before = original.toString();
    const result = writeDocumentLibraryQuery(original, scope, savedQuery, {
      q: "changed",
    });
    expect(result).not.toBe(original);
    expect(original.toString()).toBe(before);
    expect(result.get("section")).toBe("library");
    expect(result.get("tab")).toBe("documents");
    expect(result.getAll("unrelated")).toEqual(["one", "two"]);
    expect(result.get("libraryQ")).toBe("changed");
  });

  it("omits default filters while recording all current scope markers", () => {
    const params = savedParams();
    params.set("libraryOrganizationId", "old-org");
    params.set("libraryTeamBindingId", "old-team");
    params.set("libraryBrandId", "old-brand");
    const result = writeDocumentLibraryQuery(
      params,
      scope,
      savedQuery,
      defaultQuery,
    );
    expect(Object.fromEntries(result)).toEqual({
      libraryOrganizationId: scope.organizationId,
      libraryTeamBindingId: scope.teamBindingId,
      libraryBrandId: scope.brandId,
    });
    expect(readDocumentLibraryQuery(result, scope)).toEqual({
      query: defaultQuery,
      invalid: false,
    });
  });

  it("exports all library filters and markers for a complete scope reset", () => {
    const params = savedParams();
    params.set("tab", "documents");
    for (const key of libraryResetQueryKeys) params.delete(key);
    expect(Object.fromEntries(params)).toEqual({ tab: "documents" });
    expect(new Set(libraryResetQueryKeys).size).toBe(
      libraryResetQueryKeys.length,
    );
  });
});
