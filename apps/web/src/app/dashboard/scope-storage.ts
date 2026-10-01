const brandKey = (organizationId: string) =>
  `geo.scope.${organizationId}.brandId`;
const organizationKey = "geo.organizationId";

export function readStoredScopeId(
  key: string,
  availableIds: readonly string[],
) {
  try {
    const stored = localStorage.getItem(key);
    return stored && availableIds.includes(stored) ? stored : "";
  } catch {
    return "";
  }
}

export const readStoredOrganizationId = (availableIds: readonly string[]) =>
  readStoredScopeId(organizationKey, availableIds);

export const readStoredBrandId = (
  organizationId: string,
  availableIds: readonly string[],
) => readStoredScopeId(brandKey(organizationId), availableIds);

export const storeOrganizationId = (organizationId: string) =>
  storeScopeId(organizationKey, organizationId);

export const storeBrandId = (organizationId: string, brandId: string) =>
  storeScopeId(brandKey(organizationId), brandId);

function storeScopeId(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
    if (key === organizationKey && typeof window !== "undefined")
      window.dispatchEvent(new Event("geo:scope-change"));
  } catch {
    // Scope selection still works when browser storage is unavailable.
  }
}

export function selectScopeId(
  requested: string | null,
  stored: string,
  availableIds: readonly string[],
) {
  return requested && availableIds.includes(requested)
    ? requested
    : availableIds.includes(stored)
      ? stored
      : (availableIds[0] ?? "");
}

// @project-doc docs/domains/geo_operations.md#workspace_scope
export function scopedDashboardPath(
  path: string,
  organizationId: string,
  brandId?: string,
  resetQueryKeys: readonly string[] = [],
) {
  if (!organizationId) return path;
  const url = new URL(path, "https://workspace.invalid");
  const previousOrganization = url.searchParams.get("organizationId");
  const previousBrand = url.searchParams.get("brandId");
  if (
    (previousOrganization && previousOrganization !== organizationId) ||
    (previousBrand && brandId && previousBrand !== brandId)
  ) {
    for (const key of [
      "promptId",
      "promptText",
      "publicationOrderId",
      ...resetQueryKeys,
    ])
      url.searchParams.delete(key);
  }
  url.searchParams.set("organizationId", organizationId);
  if (brandId) url.searchParams.set("brandId", brandId);
  else url.searchParams.delete("brandId");
  return `${url.pathname}${url.search}${url.hash}`;
}
