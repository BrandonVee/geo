import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth/auth";
import { hasActiveUserAccess } from "@/server/auth/user-access";
import { organizationService } from "@/server/services/organizations";
import { DashboardPageHeader, DashboardShell } from "../dashboard-shell";
import { NotificationsClient } from "./notifications-client";

export default async function NotificationsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasActiveUserAccess(session.user)) redirect("/sign-in");
  const organizations = await organizationService.list(session.user.id);
  return (
    <DashboardShell
      userName={session.user.name}
      active="notifications"
      canManageBalances={organizations.some(
        (item) => item.role === "tenant_admin",
      )}
    >
      <DashboardPageHeader
        eyebrow="站内通知 / 阈值规则"
        status="每 15 分钟评估"
        title="通知中心"
      />
      <NotificationsClient
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
