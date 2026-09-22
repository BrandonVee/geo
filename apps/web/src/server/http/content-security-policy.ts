const noncePattern = /^[A-Za-z0-9+/_-]+={0,2}$/;

export const buildContentSecurityPolicy = (
  production: boolean,
  nonce?: string,
) => {
  const trustedNonce = nonce && noncePattern.test(nonce) ? nonce : undefined;
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    `script-src 'self'${trustedNonce ? ` 'nonce-${trustedNonce}' 'strict-dynamic'` : ""}${production ? "" : " 'unsafe-eval'"}`,
    "script-src-attr 'none'",
    `style-src 'self'${trustedNonce ? ` 'nonce-${trustedNonce}'` : ""}`,
    `style-src-elem 'self'${trustedNonce ? ` 'nonce-${trustedNonce}'` : ""}`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self'${production ? "" : " ws: wss: http: https:"}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    ...(production ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
};
