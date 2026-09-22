import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { buildContentSecurityPolicy } from "@/server/http/content-security-policy";

export const createCspNonce = () =>
  Buffer.from(crypto.randomUUID()).toString("base64");

export function proxy(request: NextRequest) {
  const nonce = createCspNonce();
  const policy = buildContentSecurityPolicy(
    process.env.NODE_ENV === "production",
    nonce,
  );
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", policy);
  requestHeaders.set("X-Nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|.*\\..*).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
