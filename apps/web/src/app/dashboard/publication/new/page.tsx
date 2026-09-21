import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth/auth";
import { hasActiveUserAccess } from "@/server/auth/user-access";
import { organizationService } from "@/server/services/organizations";
import { BillingClient } from "../../billing/billing-client";
import { DashboardPageHeader, DashboardShell } from "../../dashboard-shell";

export default async function NewPublicationPage({
  searchParams,
}: {
  searchParams: Promise<{
    channelId?: string;
    title?: string;
    sourceJobId?: string;
    sourceDocumentId?: string;
    note?: string;
  }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasActiveUserAccess(session.user)) redirect("/sign-in");
  const organizations = await organizationService.list(session.user.id);
  const query = await searchParams;
  return (
    <DashboardShell
      active="publication_new"
      canManageBalances={organizations.some(
        (item) => item.role === "tenant_admin",
      )}
      userName={session.user.name}
    >
      <DashboardPageHeader
        eyebrow="发布 / 内容与要求"
        status="提交后进入履约"
        title="提交媒体发布"
      />
      <BillingClient
        initialPublication={{
          title: query.title?.slice(0, 255) ?? "",
          sourceJobId: query.sourceJobId,
          sourceDocumentId: query.sourceDocumentId,
          note:
            query.note?.slice(0, 2000) ??
            (query.sourceDocumentId
              ? `来自文档库 ${query.sourceDocumentId.slice(0, 128)}`
              : query.sourceJobId
                ? `来自生成任务 ${query.sourceJobId.slice(0, 128)}`
                : ""),
        }}
        organizations={organizations.map(
          ({ id, name, role, teamBindingId }) => ({
            id,
            name,
            role,
            teamBindingId,
          }),
        )}
        selectedChannelId={query.channelId}
        view="new"
      />
    </DashboardShell>
  );
}
