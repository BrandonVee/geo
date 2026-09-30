import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth/auth";
import { hasActiveUserAccess } from "@/server/auth/user-access";
import { getPointBilledFeatureQuote } from "@/server/services/feature-billing";
import { organizationService } from "@/server/services/organizations";
import { DashboardPageHeader, DashboardShell } from "../dashboard-shell";
import { ContentClient } from "./content-client";
export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasActiveUserAccess(session.user)) redirect("/sign-in");
  const [organizations, articleGenerationQuote, effectTrackingQuote] =
    await Promise.all([
      organizationService.list(session.user.id),
      getPointBilledFeatureQuote("ai_article_generation", session.user.id),
      getPointBilledFeatureQuote("effect_tracking", session.user.id),
    ]);
  const query = await searchParams;
  return (
    <DashboardShell
      userName={session.user.name}
      active="content"
      canManageBalances={organizations.some(
        (item) => item.role === "tenant_admin",
      )}
    >
      <DashboardPageHeader eyebrow="内容 / AI 创作" title="AI 内容生成" />
      <ContentClient
        userId={session.user.id}
        featurePointCosts={{
          articleGeneration: articleGenerationQuote.points,
          effectTracking: effectTrackingQuote.points,
        }}
        initialTab={
          query.stage === "library"
            ? "library"
            : query.stage === "tracking" || query.stage === "trace"
              ? "trace"
              : "generate"
        }
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
