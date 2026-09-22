import type { AppEnv } from "@geo/config";
import { ApiError } from "@/server/http/errors";
import { getServerEnv } from "../env";

type OriginConfiguration = Pick<
  AppEnv,
  "APP_URL" | "BETTER_AUTH_URL" | "BETTER_AUTH_TRUSTED_ORIGINS"
>;

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const normalizedOrigin = (value: string) => {
  try {
    const url = new URL(value);
    if (
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
};

export const trustedOriginsFrom = (configuration: OriginConfiguration) =>
  new Set(
    [
      configuration.APP_URL,
      configuration.BETTER_AUTH_URL,
      ...configuration.BETTER_AUTH_TRUSTED_ORIGINS.split(","),
    ]
      .map((origin) => origin.trim())
      .filter(Boolean)
      .map(normalizedOrigin)
      .filter((origin): origin is string => Boolean(origin)),
  );

let cachedTrustedOrigins: ReadonlySet<string> | undefined;

export const getTrustedOrigins = () =>
  (cachedTrustedOrigins ??= trustedOriginsFrom(getServerEnv()));

export function assertTrustedWriteOrigin(
  request: Request,
  trustedOrigins: ReadonlySet<string> = getTrustedOrigins(),
) {
  if (!unsafeMethods.has(request.method.toUpperCase())) return;

  const originHeader = request.headers.get("Origin");
  if (originHeader) {
    const origin = normalizedOrigin(originHeader);
    if (origin && trustedOrigins.has(origin)) return;
    throw new ApiError(403, "UNTRUSTED_ORIGIN", "请求来源不受信任");
  }

  const fetchSite = request.headers.get("Sec-Fetch-Site")?.toLowerCase();
  if (fetchSite === "same-site" || fetchSite === "cross-site")
    throw new ApiError(403, "UNTRUSTED_ORIGIN", "请求来源不受信任");
}
