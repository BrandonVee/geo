import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth/auth";
import { hasActiveUserAccess } from "@/server/auth/user-access";
import { organizationService } from "@/server/services/organizations";
import { DashboardPageHeader, DashboardShell } from "../dashboard-shell";
import { AnswersClient } from "./answers-client";
export default async function AnswersPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasActiveUserAccess(session.user)) redirect("/sign-in");
  const organizations = await organizationService.list(session.user.id);
  return (
    <DashboardShell userName={session.user.name} active="citations">
      <DashboardPageHeader
        eyebrow="回答 / 引用"
        status="证据链"
        title="回答与引用"
      />
      <AnswersClient
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
