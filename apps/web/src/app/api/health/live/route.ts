import { noStoreJson } from "@/server/http/cache";

export const GET = () =>
  noStoreJson({ data: { status: "ok" }, requestId: crypto.randomUUID() });
