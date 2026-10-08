import { isPlatformTencentReady } from "@geo/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { auth } from "@/server/auth/auth";
import { hasActiveUserAccess } from "@/server/auth/user-access";
import { isPlatformAdministrator } from "@/server/permissions/platform";
import { platformAnswerbitRepository } from "@/server/repositories/platform-answerbit";
import { organizationService } from "@/server/services/organizations";
import { WorkspaceAccessProvider } from "./workspace-access";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasActiveUserAccess(session.user)) redirect("/sign-in");

  const [organizations, platformAdmin, platformConfiguration] =
    await Promise.all([
      organizationService.list(session.user.id),
      isPlatformAdministrator(session.user.id),
      platformAnswerbitRepository.getConfiguration(),
    ]);
  const platformReady = platformAdmin
    ? true
    : isPlatformTencentReady(platformConfiguration);
  return (
    <WorkspaceAccessProvider
      value={{
        platformAdmin,
        platformReady,
        organizations: organizations.map((item) => ({
          id: item.id,
          name: item.name,
          role: item.role,
          status: item.status,
          features: item.features,
          serviceExpiresAt: item.serviceExpiresAt?.toISOString() ?? null,
          pointsExpiresAt: item.pointsExpiresAt?.toISOString() ?? null,
        })),
      }}
    >
      {children}
    </WorkspaceAccessProvider>
  );
}
