import { apiJson } from "./response";

export const NO_STORE_CACHE_CONTROL = "no-store, max-age=0";

export function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", NO_STORE_CACHE_CONTROL);
  return apiJson(body, { ...init, headers });
}

export function withNoStore(response: Response) {
  response.headers.set("Cache-Control", NO_STORE_CACHE_CONTROL);
  return response;
}
