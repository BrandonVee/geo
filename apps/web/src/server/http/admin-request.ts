import {
  adminPageQuerySchema,
  adminUserPageQuerySchema,
  adminOrganizationPageQuerySchema,
} from "@geo/contracts";
import { ApiError } from "./errors";
export function parseAdminPage(request: Request) {
  const parsed = adminPageQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success)
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "分页或筛选参数有误",
      parsed.error.issues,
    );
  return parsed.data;
}

export function parseAdminUserPage(request: Request) {
  const parsed = adminUserPageQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success)
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "用户分页或筛选参数有误",
      parsed.error.issues,
    );
  return parsed.data;
}
export function parseAdminOrganizationPage(request: Request) {
  const parsed = adminOrganizationPageQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success)
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "企业分页或筛选参数有误",
      parsed.error.issues,
    );
  return parsed.data;
}
