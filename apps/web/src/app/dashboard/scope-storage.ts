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
