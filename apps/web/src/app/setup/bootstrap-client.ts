export async function isBootstrapComplete(): Promise<boolean> {
  try {
    const response = await fetch("/api/v1/system/bootstrap", {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return false;
    const body = await response.json();
    return body.data?.initialized === true;
  } catch {
    return false;
  }
}

export async function submitBootstrap(values: {
  name: string;
  username: string;
  password: string;
}): Promise<{ complete: true } | { complete: false; message: string }> {
  try {
    const response = await fetch("/api/v1/system/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
      signal: AbortSignal.timeout(30_000),
    });
    // A committed creation must not depend on parsing its response body.
    if (response.status === 201) return { complete: true };
    const body = await response.json().catch(() => null);
    if (
      response.status === 409 &&
      body?.error?.code === "SYSTEM_ALREADY_INITIALIZED"
    ) {
      return { complete: true };
    }
    if (response.status >= 500 && (await isBootstrapComplete())) {
      return { complete: true };
    }
    return {
      complete: false,
      message: body?.error?.message ?? "初始化失败，请检查输入后重试",
    };
  } catch {
    // The transaction may have committed before the connection was lost.
    if (await isBootstrapComplete()) return { complete: true };
    return {
      complete: false,
      message: "尚未确认初始化完成，请检查网络后重试",
    };
  }
}
