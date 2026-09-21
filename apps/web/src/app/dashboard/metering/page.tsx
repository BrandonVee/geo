import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth/auth";
import { hasActiveUserAccess } from "@/server/auth/user-access";
import { organizationService } from "@/server/services/organizations";
import { DashboardPageHeader, DashboardShell } from "../dashboard-shell";
import { PointUsageClient } from "./point-usage-client";

export default async function MeteringPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasActiveUserAccess(session.user)) redirect("/sign-in");
  const organizations = await organizationService.list(session.user.id);
  return (
    <DashboardShell
      userName={session.user.name}
      active="metering"
      canManageBalances={organizations.some(
        (item) => item.role === "tenant_admin",
      )}
    >
      <DashboardPageHeader
        eyebrow="积分 / 用量"
        status="本系统积分账本"
        title="积分与消耗"
      />
      <PointUsageClient
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
