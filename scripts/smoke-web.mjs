const baseUrl = new URL(process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000");
const startupTimeoutMs = Number(process.env.SMOKE_STARTUP_TIMEOUT_MS ?? 60_000);

const request = (path, options = {}) =>
  fetch(new URL(path, baseUrl), {
    redirect: "manual",
    signal: AbortSignal.timeout(5_000),
    ...options,
  });

const readJson = async (response, path) => {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json"))
    throw new Error(
      `${path} returned unexpected content-type ${contentType || "<empty>"}`,
    );
  return response.json();
};

const assertStatus = (response, expected, path) => {
  if (response.status !== expected)
    throw new Error(
      `${path} returned ${response.status}, expected ${expected}`,
    );
};

const assertNoStore = (response, path) => {
  if (response.headers.get("cache-control") !== "no-store, max-age=0")
    throw new Error(`${path} permits cached API responses`);
};

const assertRequestId = (response, body, path) => {
  if (
    typeof body?.requestId !== "string" ||
    response.headers.get("x-request-id") !== body.requestId
  )
    throw new Error(`${path} returned mismatched request IDs`);
};

const waitForLive = async () => {
  const deadline = Date.now() + startupTimeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await request("/api/health/live");
      if (response.ok) return response;
      lastError = new Error(`live probe returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `web process did not become live within ${startupTimeoutMs}ms: ${lastError instanceof Error ? lastError.message : "unknown error"}`,
  );
};

const liveResponse = await waitForLive();
const live = await readJson(liveResponse, "/api/health/live");
if (live?.data?.status !== "ok" || typeof live.requestId !== "string")
  throw new Error("live probe returned an invalid response envelope");
assertNoStore(liveResponse, "/api/health/live");
assertRequestId(liveResponse, live, "/api/health/live");

for (const [name, value] of [
  ["x-content-type-options", "nosniff"],
  ["x-frame-options", "DENY"],
  ["x-dns-prefetch-control", "off"],
  ["x-permitted-cross-domain-policies", "none"],
  ["cross-origin-opener-policy", "same-origin"],
  ["cross-origin-resource-policy", "same-origin"],
  ["origin-agent-cluster", "?1"],
  ["referrer-policy", "strict-origin-when-cross-origin"],
  ["permissions-policy", "camera=(), microphone=(), geolocation=()"],
]) {
  if (liveResponse.headers.get(name) !== value)
    throw new Error(`live probe is missing security header ${name}`);
}
if (liveResponse.headers.has("x-powered-by"))
  throw new Error("live probe exposes the x-powered-by header");
if (
  liveResponse.headers.get("strict-transport-security") !==
  "max-age=31536000; includeSubDomains"
)
  throw new Error("live probe is missing production HSTS");

const contentSecurityPolicy =
  liveResponse.headers.get("content-security-policy") ?? "";
for (const directive of [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src-attr 'none'",
  "connect-src 'self'",
]) {
  if (!contentSecurityPolicy.includes(directive))
    throw new Error(`live probe CSP is missing ${directive}`);
}
if (contentSecurityPolicy.includes("'unsafe-eval'"))
  throw new Error("production CSP permits unsafe eval");
const apiScriptDirective = contentSecurityPolicy
  .split(";")
  .find((directive) => directive.trim().startsWith("script-src "));
if (!apiScriptDirective || apiScriptDirective.includes("'unsafe-inline'"))
  throw new Error("production CSP permits unsafe inline scripts");

const readyResponse = await request("/api/health/ready");
assertStatus(readyResponse, 200, "/api/health/ready");
const ready = await readJson(readyResponse, "/api/health/ready");
if (ready?.data?.status !== "ready" || typeof ready.requestId !== "string")
  throw new Error("readiness probe returned an invalid response envelope");
assertNoStore(readyResponse, "/api/health/ready");
assertRequestId(readyResponse, ready, "/api/health/ready");

const bootstrapResponse = await request("/api/v1/system/bootstrap");
assertStatus(bootstrapResponse, 200, "/api/v1/system/bootstrap");
const bootstrap = await readJson(bootstrapResponse, "/api/v1/system/bootstrap");
assertNoStore(bootstrapResponse, "/api/v1/system/bootstrap");
assertRequestId(bootstrapResponse, bootstrap, "/api/v1/system/bootstrap");
if (
  typeof bootstrap?.data?.initialized !== "boolean" ||
  typeof bootstrap.requestId !== "string"
)
  throw new Error("bootstrap status returned an invalid response envelope");

const oversizedPath = "/api/v1/system/bootstrap (oversized JSON)";
const oversizedResponse = await request("/api/v1/system/bootstrap", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: baseUrl.origin,
  },
  body: JSON.stringify({ payload: "x".repeat(4 * 1024 * 1024) }),
});
assertStatus(oversizedResponse, 413, oversizedPath);
assertNoStore(oversizedResponse, oversizedPath);
const oversized = await readJson(oversizedResponse, oversizedPath);
if (oversized?.error?.code !== "PAYLOAD_TOO_LARGE")
  throw new Error("oversized JSON returned an unexpected error");
assertRequestId(oversizedResponse, oversized, oversizedPath);

const unsupportedMediaTypePath =
  "/api/v1/system/bootstrap (unsupported media type)";
const unsupportedMediaTypeResponse = await request("/api/v1/system/bootstrap", {
  method: "POST",
  headers: {
    "Content-Type": "text/plain",
    Origin: baseUrl.origin,
  },
  body: "{}",
});
assertStatus(unsupportedMediaTypeResponse, 415, unsupportedMediaTypePath);
assertNoStore(unsupportedMediaTypeResponse, unsupportedMediaTypePath);
const unsupportedMediaType = await readJson(
  unsupportedMediaTypeResponse,
  unsupportedMediaTypePath,
);
if (unsupportedMediaType?.error?.code !== "UNSUPPORTED_MEDIA_TYPE")
  throw new Error("non-JSON request returned an unexpected error");
assertRequestId(
  unsupportedMediaTypeResponse,
  unsupportedMediaType,
  unsupportedMediaTypePath,
);

const invalidJsonPath = "/api/v1/system/bootstrap (invalid JSON)";
const invalidJsonResponse = await request("/api/v1/system/bootstrap", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: baseUrl.origin,
  },
  body: "{invalid",
});
assertStatus(invalidJsonResponse, 400, invalidJsonPath);
assertNoStore(invalidJsonResponse, invalidJsonPath);
const invalidJson = await readJson(invalidJsonResponse, invalidJsonPath);
if (invalidJson?.error?.code !== "INVALID_JSON")
  throw new Error("malformed JSON returned an unexpected error");
assertRequestId(invalidJsonResponse, invalidJson, invalidJsonPath);

const untrustedOriginPath = "/api/v1/system/bootstrap (untrusted Origin)";
const untrustedOriginResponse = await request("/api/v1/system/bootstrap", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: "https://untrusted.example",
  },
  body: "{}",
});
assertStatus(untrustedOriginResponse, 403, untrustedOriginPath);
assertNoStore(untrustedOriginResponse, untrustedOriginPath);
const untrustedOrigin = await readJson(
  untrustedOriginResponse,
  untrustedOriginPath,
);
if (untrustedOrigin?.error?.code !== "UNTRUSTED_ORIGIN")
  throw new Error("untrusted browser origin returned an unexpected error");
assertRequestId(untrustedOriginResponse, untrustedOrigin, untrustedOriginPath);

const unauthorizedResponse = await request("/api/v1/organizations");
assertStatus(unauthorizedResponse, 401, "/api/v1/organizations");
assertNoStore(unauthorizedResponse, "/api/v1/organizations");
const unauthorized = await readJson(
  unauthorizedResponse,
  "/api/v1/organizations",
);
if (
  unauthorized?.error?.code !== "AUTH_REQUIRED" ||
  typeof unauthorized.requestId !== "string"
)
  throw new Error("protected API returned an invalid authentication error");
assertRequestId(unauthorizedResponse, unauthorized, "/api/v1/organizations");

const signInFailureResponse = await request("/api/auth/sign-in/username", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: baseUrl.origin,
  },
  body: JSON.stringify({
    username: `smoke_missing_${Date.now()}`,
    password: "SmokeMissing123!",
  }),
});
assertStatus(signInFailureResponse, 401, "/api/auth/sign-in/username");
assertNoStore(signInFailureResponse, "/api/auth/sign-in/username");
if (!signInFailureResponse.headers.get("x-request-id"))
  throw new Error("authentication response is missing X-Request-ID");

const setupResponse = await request("/setup");
const signInResponse = await request("/sign-in");
if (bootstrap.data.initialized) {
  if (![307, 308].includes(setupResponse.status))
    throw new Error("initialized setup page did not redirect");
  if (setupResponse.headers.get("location") !== "/sign-in")
    throw new Error("initialized setup page redirected to an unexpected path");
  assertStatus(signInResponse, 200, "/sign-in");
} else {
  assertStatus(setupResponse, 200, "/setup");
  if (![307, 308].includes(signInResponse.status))
    throw new Error("uninitialized sign-in page did not redirect");
  if (signInResponse.headers.get("location") !== "/setup")
    throw new Error(
      "uninitialized sign-in page redirected to an unexpected path",
    );
}

const renderedPage = bootstrap.data.initialized
  ? signInResponse
  : setupResponse;
if (!(renderedPage.headers.get("content-type") ?? "").includes("text/html"))
  throw new Error("authentication entry page did not return HTML");
const renderedPolicy =
  renderedPage.headers.get("content-security-policy") ?? "";
const renderedScriptDirective = renderedPolicy
  .split(";")
  .find((directive) => directive.trim().startsWith("script-src "));
const renderedNonce = renderedScriptDirective?.match(/'nonce-([^']+)'/)?.[1];
if (
  !renderedNonce ||
  !renderedScriptDirective?.includes("'strict-dynamic'") ||
  renderedScriptDirective.includes("'unsafe-inline'")
)
  throw new Error("rendered page is missing strict nonce-based script CSP");
const renderedHtml = await renderedPage.text();
const scriptTags = [...renderedHtml.matchAll(/<script\b([^>]*)>/gi)];
if (
  scriptTags.length === 0 ||
  scriptTags.some(([, attributes]) => {
    const nonce = attributes.match(/\bnonce="([^"]+)"/i)?.[1];
    return nonce !== renderedNonce;
  })
)
  throw new Error("rendered page contains a script without the current nonce");
const nextRenderedPage = await request(
  bootstrap.data.initialized ? "/sign-in" : "/setup",
);
const nextNonce = nextRenderedPage.headers
  .get("content-security-policy")
  ?.match(/'nonce-([^']+)'/)?.[1];
if (!nextNonce || nextNonce === renderedNonce)
  throw new Error("rendered pages do not rotate CSP nonces per request");
const assetPath = renderedHtml.match(
  /(?:src|href)="([^"?]*\/_next\/static\/[^"?]+)(?:\?[^"?]*)?"/,
)?.[1];
if (!assetPath)
  throw new Error("authentication entry page did not reference a static asset");
const assetResponse = await request(assetPath);
if (!assetResponse.ok)
  throw new Error(`static asset ${assetPath} returned ${assetResponse.status}`);
if ((assetResponse.headers.get("cache-control") ?? "").includes("no-store"))
  throw new Error(`static asset ${assetPath} was incorrectly marked no-store`);

console.log(
  JSON.stringify({
    event: "web-smoke.completed",
    baseUrl: baseUrl.origin,
    initialized: bootstrap.data.initialized,
  }),
);
