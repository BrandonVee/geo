import { isPlatformTencentReady } from "@geo/core";
import { Card, Result } from "antd";
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

  const configuration = await platformAnswerbitRepository.getConfiguration();
  if (!isPlatformTencentReady(configuration)) {
    if (await isPlatformAdministrator(session.user.id))
      redirect("/admin?section=integration");
    return (
      <main style={{ margin: "64px auto", maxWidth: 720, padding: 24 }}>
        <Card>
          <Result
            status="warning"
            subTitle="平台管理员完成腾讯接入验证后，企业及业务模块会自动开放。"
            title="等待平台完成腾讯接入"
          />
        </Card>
      </main>
    );
  }

  const [organizations, platformAdmin] = await Promise.all([
    organizationService.list(session.user.id),
    isPlatformAdministrator(session.user.id),
  ]);
  return (
    <WorkspaceAccessProvider
      value={{
        platformAdmin,
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
