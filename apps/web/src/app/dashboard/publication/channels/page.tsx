import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth/auth";
import { hasActiveUserAccess } from "@/server/auth/user-access";
import { organizationService } from "@/server/services/organizations";
import { DashboardPageHeader, DashboardShell } from "../../dashboard-shell";
import { PublicationChannelsClient } from "./channels-client";

export default async function PublicationChannelsPage({
  searchParams,
}: {
  searchParams: Promise<{
    title?: string;
    sourceJobId?: string;
    sourceDocumentId?: string;
    note?: string;
    organizationId?: string;
    brandId?: string;
  }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasActiveUserAccess(session.user)) redirect("/sign-in");
  const organizations = await organizationService.list(session.user.id);
  const query = await searchParams;
  return (
    <DashboardShell
      active="publication_channels"
      canManageBalances={organizations.some(
        (item) => item.role === "tenant_admin",
      )}
      userName={session.user.name}
    >
      <DashboardPageHeader
        eyebrow="发布 / 渠道选择"
        status="实时等级售价"
        title="媒体渠道库"
      />
      <PublicationChannelsClient
        draft={{
          organizationId: query.organizationId,
          brandId: query.brandId,
          title: query.title?.slice(0, 255),
          sourceJobId: query.sourceJobId,
          sourceDocumentId: query.sourceDocumentId,
          note: query.note?.slice(0, 2000),
        }}
      />
    </DashboardShell>
  );
}
