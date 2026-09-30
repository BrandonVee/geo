export class EnterpriseAccessError extends Error {
  constructor(
    public readonly code:
      | "ORGANIZATION_NOT_FOUND"
      | "ORGANIZATION_SUSPENDED"
      | "ORGANIZATION_EXPIRED"
      | "POINTS_EXPIRED",
    message: string,
  ) {
    super(message);
  }
}
export function validateEnterpriseAccess(
  organization:
    | {
        status: string;
        serviceExpiresAt?: Date | null;
        pointsExpiresAt?: Date | null;
      }
    | undefined,
  requirePoints = false,
  now = new Date(),
) {
  if (!organization)
    throw new EnterpriseAccessError("ORGANIZATION_NOT_FOUND", "企业不存在");
  if (organization.status !== "active")
    throw new EnterpriseAccessError(
      "ORGANIZATION_SUSPENDED",
      "企业已被冻结或关闭",
    );
  if (organization.serviceExpiresAt && organization.serviceExpiresAt <= now)
    throw new EnterpriseAccessError(
      "ORGANIZATION_EXPIRED",
      "企业服务已到期，请联系管理员续期",
    );
  if (
    requirePoints &&
    organization.pointsExpiresAt &&
    organization.pointsExpiresAt <= now
  )
    throw new EnterpriseAccessError(
      "POINTS_EXPIRED",
      "企业积分有效期已结束，请联系管理员处理",
    );
}
