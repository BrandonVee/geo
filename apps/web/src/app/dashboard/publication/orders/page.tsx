import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth/auth";
import { hasActiveUserAccess } from "@/server/auth/user-access";
import { organizationService } from "@/server/services/organizations";
import { BillingClient } from "../../billing/billing-client";
import { DashboardPageHeader, DashboardShell } from "../../dashboard-shell";

export default async function PublicationOrdersPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasActiveUserAccess(session.user)) redirect("/sign-in");
  const organizations = await organizationService.list(session.user.id);
  return (
    <DashboardShell
      active="publication_orders"
      canManageBalances={organizations.some(
        (item) => item.role === "tenant_admin",
      )}
      userName={session.user.name}
    >
      <DashboardPageHeader
        eyebrow="发布 / 履约跟踪"
        status="每分钟刷新"
        title="发布订单"
      />
      <BillingClient
        userId={session.user.id}
        initialPublication={{ title: "", note: "" }}
        organizations={organizations.map(
          ({ id, name, role, teamBindingId }) => ({
            id,
            name,
            role,
            teamBindingId,
          }),
        )}
        view="orders"
      />
    </DashboardShell>
  );
}
