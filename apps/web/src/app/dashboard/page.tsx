import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Card, Result } from "antd";
import { auth } from "@/server/auth/auth";
import { hasActiveUserAccess } from "@/server/auth/user-access";
import { organizationService } from "@/server/services/organizations";
import { DashboardPageHeader, DashboardShell } from "./dashboard-shell";
import { OverviewClient } from "./overview-client";
export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasActiveUserAccess(session.user)) redirect("/sign-in");
  const organizations = await organizationService.list(session.user.id);
  const accountType =
    (session.user as { accountType?: "admin" | "agent" | "customer" })
      .accountType ?? "customer";
  return (
    <DashboardShell
      userName={session.user.name}
      active="overview"
      canManageBalances={organizations.some(
        (item) => item.role === "tenant_admin",
      )}
    >
      <DashboardPageHeader
        eyebrow={`品牌可见度 · 欢迎回来，${session.user.name}`}
        status="每日更新"
        title="数据总览"
      />
      {organizations.length ? (
        <OverviewClient
          organizations={organizations.map(
            ({ id, name, role, teamBindingId }) => ({
              id,
              name,
              role,
              teamBindingId,
            }),
          )}
        />
      ) : accountType === "customer" ? (
        <Card style={{ margin: 24 }}>
          <Result
            status="info"
            subTitle="账户已开通，请联系管理员完成企业和品牌权限配置。"
            title="等待分配企业与品牌"
          />
        </Card>
      ) : (
        <Card style={{ margin: 24 }}>
          <Result
            status="info"
            subTitle="平台企业来自腾讯品牌目录，请由平台管理员完成腾讯接入并创建企业，再配置成员权限。"
            title="等待腾讯企业授权"
          />
        </Card>
      )}
    </DashboardShell>
  );
}
