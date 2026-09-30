export type UserAccessFields = {
  status?: string | null;
  accountType?: string | null;
  agentValidFrom?: Date | string | null;
  agentExpiresAt?: Date | string | null;
};

export type UserAccessState = "active" | "disabled" | "scheduled" | "expired";

function timestamp(value: Date | string | null | undefined) {
  if (!value) return null;
  const time =
    value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export function getUserAccessState(
  user: UserAccessFields,
  now = Date.now(),
): UserAccessState {
  if (user.status === "disabled") return "disabled";
  if (user.accountType !== "agent") return "active";

  const validFrom = timestamp(user.agentValidFrom);
  const expiresAt = timestamp(user.agentExpiresAt);
  if (validFrom !== null && validFrom > now) return "scheduled";
  if (expiresAt !== null && expiresAt <= now) return "expired";
  return "active";
}

export function hasActiveUserAccess(user: UserAccessFields, now = Date.now()) {
  return getUserAccessState(user, now) === "active";
}
