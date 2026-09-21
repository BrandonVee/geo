import { redirect } from "next/navigation";

export default async function LegacyBillingPage({
  searchParams,
}: {
  searchParams: Promise<{
    title?: string;
    sourceJobId?: string;
    sourceDocumentId?: string;
  }>;
}) {
  const query = await searchParams;
  const hasDraft = Boolean(
    query.title || query.sourceJobId || query.sourceDocumentId,
  );
  if (!hasDraft) redirect("/dashboard/publication/orders");
  const params = new URLSearchParams();
  if (query.title) params.set("title", query.title);
  if (query.sourceJobId) params.set("sourceJobId", query.sourceJobId);
  if (query.sourceDocumentId)
    params.set("sourceDocumentId", query.sourceDocumentId);
  redirect(`/dashboard/publication/new?${params}`);
}
