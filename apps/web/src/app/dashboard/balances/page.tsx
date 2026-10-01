import { Card, Result } from "antd";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth/auth";
import { hasActiveUserAccess } from "@/server/auth/user-access";
import { organizationService } from "@/server/services/organizations";
import { DashboardPageHeader, DashboardShell } from "../dashboard-shell";
import { BalanceManagementClient } from "./balance-management-client";

export default async function BalanceManagementPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasActiveUserAccess(session.user)) redirect("/sign-in");
  const memberships = await organizationService.list(session.user.id);
  const organizations = memberships.filter(
    (item) => item.role === "tenant_admin",
  );

  return (
    <DashboardShell
      active="balances"
      canManageBalances={organizations.length > 0}
      userName={session.user.name}
    >
      <DashboardPageHeader
        eyebrow="企业资产 / 品牌账户"
        status="企业管理员能力"
        title="资产划拨"
      />
      {organizations.length ? (
        <BalanceManagementClient
          userId={session.user.id}
          organizations={organizations.map(
            ({ id, name, role, teamBindingId }) => ({
              id,
              name,
              role,
              teamBindingId,
            }),
          )}
        />
      ) : (
        <Card style={{ margin: 24 }}>
          <Result
            status="403"
            subTitle="资产划拨只向拥有 balance.allocate 能力的企业管理员开放。"
            title="当前账号没有资产划拨能力"
          />
        </Card>
      )}
    </DashboardShell>
  );
}
