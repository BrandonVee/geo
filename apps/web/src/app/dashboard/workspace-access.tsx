"use client";

import { createContext, useContext, type ReactNode } from "react";
import {
  featureScopeAllowsPermission,
  hasPermission,
  type OrganizationFeature,
  type Permission,
  type Role,
} from "@geo/core";

export type WorkspaceOrganization = {
  id: string;
  name: string;
  role: string | null;
  status: string;
  features: OrganizationFeature[] | null;
  serviceExpiresAt: string | null;
  pointsExpiresAt: string | null;
};
type WorkspaceAccess = {
  organizations: WorkspaceOrganization[];
  platformAdmin: boolean;
};
const Context = createContext<WorkspaceAccess>({
  organizations: [],
  platformAdmin: false,
});
export function WorkspaceAccessProvider({
  value,
  children,
}: {
  value: WorkspaceAccess;
  children: ReactNode;
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useWorkspaceAccess = () => useContext(Context);
export function workspacePermission(
  organization: WorkspaceOrganization | undefined,
  role: string | undefined | null,
  permission: Permission,
  feature?: OrganizationFeature,
) {
  if (
    !role ||
    !["tenant_admin", "brand_admin", "brand_editor", "brand_viewer"].includes(
      role,
    )
  )
    return false;
  return (
    hasPermission(role as Role, permission) &&
    (organization?.features == null ||
      (feature
        ? organization.features.includes(feature)
        : featureScopeAllowsPermission(organization.features, permission)))
  );
}
