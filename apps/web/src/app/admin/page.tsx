import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth/auth";
import { hasActiveUserAccess } from "@/server/auth/user-access";
import { requirePlatformPermission } from "@/server/permissions/platform";
import { platformAnswerbitRepository } from "@/server/repositories/platform-answerbit";
import { AdminClient } from "./admin-client";
export default async function AdminPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasActiveUserAccess(session.user)) redirect("/sign-in");
  try {
    await requirePlatformPermission(session.user.id, "platform.tenant.read", {
      allowBeforeTencentConnection: true,
    });
  } catch {
    redirect("/dashboard");
  }
  const meteringOrganizations =
    await platformAnswerbitRepository.listMeteringScopes();
  return (
    <AdminClient
      userId={session.user.id}
      meteringOrganizations={meteringOrganizations}
      userName={session.user.name}
    />
  );
}
