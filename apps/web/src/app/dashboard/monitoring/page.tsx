import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth/auth";
import { hasActiveUserAccess } from "@/server/auth/user-access";
import { organizationService } from "@/server/services/organizations";
import { DashboardPageHeader, DashboardShell } from "../dashboard-shell";
import { MonitoringClient } from "./monitoring-client";
export default async function MonitoringPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasActiveUserAccess(session.user)) redirect("/sign-in");
  const organizations = await organizationService.list(session.user.id);
  return (
    <DashboardShell
      userName={session.user.name}
      active="monitoring"
      canManageBalances={organizations.some(
        (item) => item.role === "tenant_admin",
      )}
    >
      <DashboardPageHeader
        eyebrow="品牌 / 监控"
        status="AnswerBit 数据"
        title="监控问题库"
      />
      <MonitoringClient
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
    </DashboardShell>
  );
}
