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

for (const [name, value] of [
  ["x-content-type-options", "nosniff"],
  ["x-frame-options", "DENY"],
  ["x-dns-prefetch-control", "off"],
  ["x-permitted-cross-domain-policies", "none"],
  ["cross-origin-opener-policy", "same-origin"],
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

const readyResponse = await request("/api/health/ready");
assertStatus(readyResponse, 200, "/api/health/ready");
const ready = await readJson(readyResponse, "/api/health/ready");
if (ready?.data?.status !== "ready" || typeof ready.requestId !== "string")
  throw new Error("readiness probe returned an invalid response envelope");

const bootstrapResponse = await request("/api/v1/system/bootstrap");
assertStatus(bootstrapResponse, 200, "/api/v1/system/bootstrap");
const bootstrap = await readJson(bootstrapResponse, "/api/v1/system/bootstrap");
if (
  typeof bootstrap?.data?.initialized !== "boolean" ||
  typeof bootstrap.requestId !== "string"
)
  throw new Error("bootstrap status returned an invalid response envelope");

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
const renderedHtml = await renderedPage.text();
const assetPath = renderedHtml.match(
  /(?:src|href)="([^"?]*\/_next\/static\/[^"?]+)(?:\?[^"?]*)?"/,
)?.[1];
if (!assetPath)
  throw new Error("authentication entry page did not reference a static asset");
const assetResponse = await request(assetPath);
if (!assetResponse.ok)
  throw new Error(`static asset ${assetPath} returned ${assetResponse.status}`);

console.log(
  JSON.stringify({
    event: "web-smoke.completed",
    baseUrl: baseUrl.origin,
    initialized: bootstrap.data.initialized,
  }),
);
