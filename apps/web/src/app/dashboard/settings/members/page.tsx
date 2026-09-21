import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth/auth";
import { hasActiveUserAccess } from "@/server/auth/user-access";
import { organizationService } from "@/server/services/organizations";
import { DashboardShell } from "../../dashboard-shell";
import { SettingsFrame, SettingsPermissionResult } from "../settings-frame";
import { MemberSettings } from "./members-client";

type PageProps = {
  searchParams: Promise<{ organizationId?: string }>;
};

export default async function MemberSettingsPage({ searchParams }: PageProps) {
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
      active="members"
      canManageBalances={memberships.some(
        (item) => item.role === "tenant_admin",
      )}
    >
      <SettingsFrame
        active="members"
        description="把平台已创建的账号加入企业，并以角色和品牌范围控制最小访问权限。"
        organizationId={organization?.id}
        organizations={organizations.map(({ id, name, role, status }) => ({
          id,
          name,
          role,
          status,
        }))}
        title="成员与数据权限"
      >
        {organization ? (
          <MemberSettings
            brandId={organization.answerbitBrandId}
            brandName={organization.answerbitBrandName}
            key={organization.id}
            organizationId={organization.id}
            organizationName={organization.name}
          />
        ) : (
          <SettingsPermissionResult description="只有企业管理员可以添加成员和分配品牌数据范围。" />
        )}
      </SettingsFrame>
    </DashboardShell>
  );
}
