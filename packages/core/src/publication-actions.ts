export type PublicationProviderAction = {
  id: string;
  operation: "cancel" | "appeal";
  state: "pending" | "uncertain" | "completed" | "rejected" | "released";
  actorUserId: string;
  startedAt: string;
  expiresAt: string;
  dispatchedAt?: string;
  reason?: 1 | 2 | 3 | 4;
  detail?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionNote?: string;
};

export function publicationActionPending(
  action?: PublicationProviderAction | null,
) {
  return Boolean(action && ["pending", "uncertain"].includes(action.state));
}

// @project-doc docs/domains/balance_and_publication.md#publication_state_machine
export function observePublicationAction(
  action: PublicationProviderAction | null,
  status: string,
  providerStatus?: number | null,
) {
  if (!action || !publicationActionPending(action)) return action;
  if (
    ["cancelled", "failed"].includes(status) ||
    (action.operation === "appeal" && providerStatus === 9)
  )
    return {
      ...action,
      state: "completed" as const,
      resolvedAt: new Date().toISOString(),
    };
  return action;
}
