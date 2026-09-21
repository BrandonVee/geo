import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth/auth";
import { hasActiveUserAccess } from "@/server/auth/user-access";
import { organizationService } from "@/server/services/organizations";
import { DashboardPageHeader, DashboardShell } from "../dashboard-shell";
import { BillingClient } from "./billing-client";
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{
    title?: string;
    sourceJobId?: string;
    sourceDocumentId?: string;
  }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasActiveUserAccess(session.user)) redirect("/sign-in");
  const organizations = await organizationService.list(session.user.id);
  const query = await searchParams;
  return (
    <DashboardShell userName={session.user.name} active="billing">
      <DashboardPageHeader
        eyebrow="余额 / 发布"
        status="管理员与代理商划分"
        title="余额与发布"
      />
      <BillingClient
        initialPublication={{
          title: query.title?.slice(0, 255) ?? "",
          sourceJobId: query.sourceJobId,
          sourceDocumentId: query.sourceDocumentId,
          note: query.sourceDocumentId
            ? `来自文档库 ${query.sourceDocumentId.slice(0, 128)}`
            : query.sourceJobId
              ? `来自生成任务 ${query.sourceJobId.slice(0, 128)}`
              : "",
        }}
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
