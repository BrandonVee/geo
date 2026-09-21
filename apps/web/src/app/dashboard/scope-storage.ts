const brandKey = (organizationId: string) =>
  `geo.scope.${organizationId}.brandId`;
const organizationKey = "geo.organizationId";

export function readStoredScopeId(
  key: string,
  availableIds: readonly string[],
) {
  const stored = localStorage.getItem(key);
  return stored && availableIds.includes(stored) ? stored : "";
}

export const readStoredOrganizationId = (availableIds: readonly string[]) =>
  readStoredScopeId(organizationKey, availableIds);

export const readStoredBrandId = (
  organizationId: string,
  availableIds: readonly string[],
) => readStoredScopeId(brandKey(organizationId), availableIds);

export const storeOrganizationId = (organizationId: string) =>
  localStorage.setItem(organizationKey, organizationId);

export const storeBrandId = (organizationId: string, brandId: string) =>
  localStorage.setItem(brandKey(organizationId), brandId);
