import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth/auth";
import { hasActiveUserAccess } from "@/server/auth/user-access";
import { organizationService } from "@/server/services/organizations";
import { DashboardShell } from "../../dashboard-shell";
import { SettingsFrame, SettingsPermissionResult } from "../settings-frame";
import { AnswerBitSettings } from "./settings-client";

type PageProps = {
  searchParams: Promise<{ organizationId?: string }>;
};

export default async function AnswerBitSettingsPage({
  searchParams,
}: PageProps) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasActiveUserAccess(session.user)) redirect("/sign-in");

  const memberships = await organizationService.list(session.user.id);
  const organizations = Array.from(
    new Map(
      memberships
        .filter((item) => item.role === "tenant_admin")
        .map((item) => [item.id, item]),
    ).values(),
  );
  const requestedOrganizationId = (await searchParams).organizationId;
  const organization =
    organizations.find((item) => item.id === requestedOrganizationId) ??
    organizations[0];

  return (
    <DashboardShell
      userName={session.user.name}
      active="answerbit"
      canManageBalances={memberships.some(
        (item) => item.role === "tenant_admin",
      )}
    >
      <SettingsFrame
        active="answerbit"
        description="查看平台腾讯服务状态和本企业对应的腾讯品牌范围。"
        organizationId={organization?.id}
        organizations={organizations.map(({ id, name, role, status }) => ({
          id,
          name,
          role,
          status,
        }))}
        title="腾讯接入"
      >
        {organization ? (
          <AnswerBitSettings
            key={organization.id}
            organizationId={organization.id}
            organizationName={organization.name}
          />
        ) : (
          <SettingsPermissionResult description="只有企业管理员可以查看本企业的腾讯品牌接入；统一凭证由平台管理员配置，腾讯侧授权由官方控制台管理。" />
        )}
      </SettingsFrame>
    </DashboardShell>
  );
}
