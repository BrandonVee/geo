import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isPlatformTencentReady } from "@geo/core";
import { auth } from "@/server/auth/auth";
import { hasActiveUserAccess } from "@/server/auth/user-access";
import { requirePlatformPermission } from "@/server/permissions/platform";
import { platformAnswerbitRepository } from "@/server/repositories/platform-answerbit";
import { AdminClient } from "./admin-client";
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasActiveUserAccess(session.user)) redirect("/sign-in");
  try {
    await requirePlatformPermission(session.user.id, "platform.tenant.read", {
      allowBeforeTencentConnection: true,
    });
  } catch {
    redirect("/dashboard");
  }
  const [configuration, meteringOrganizations] = await Promise.all([
    platformAnswerbitRepository.getConfiguration(),
    platformAnswerbitRepository.listMeteringScopes(),
  ]);
  if (
    !isPlatformTencentReady(configuration) &&
    (await searchParams).section !== "integration"
  )
    redirect("/admin?section=integration");
  return (
    <AdminClient
      userId={session.user.id}
      meteringOrganizations={meteringOrganizations}
      userName={session.user.name}
    />
  );
}
