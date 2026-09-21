import { db, operationLogs } from "@geo/db";
export type AuditContext = {
  organizationId?: string;
  actorUserId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
};
export async function writeAudit(
  context: AuditContext,
  input: {
    operation: string;
    resourceType: string;
    resourceId?: string;
    summary?: string;
    result?: "success" | "failed";
  },
) {
  await db.insert(operationLogs).values({
    organizationId: context.organizationId,
    actorUserId: context.actorUserId,
    requestId: context.requestId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    operation: input.operation,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    summary: input.summary,
    result: input.result ?? "success",
  });
}
export const auditContextFromRequest = (
  request: Request,
  organizationId: string | undefined,
  actorUserId: string,
  requestId: string,
): AuditContext => ({
  organizationId,
  actorUserId,
  requestId,
  ipAddress:
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
  userAgent: request.headers.get("user-agent") ?? undefined,
});
