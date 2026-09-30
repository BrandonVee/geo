import { z } from "zod";
import { PublicationAttempt } from "../billing/publication-attempt";

const snapshotSchema = z.object({
  fingerprint: z.string(),
  key: z.string().uuid(),
});

/** Network retries and refreshes retain one submission in this browser tab. */
export class ReportAttempt extends PublicationAttempt {
  constructor(private readonly storageKey: string) {
    let snapshot;
    try {
      const parsed = snapshotSchema.safeParse(
        JSON.parse(sessionStorage.getItem(storageKey) ?? "null"),
      );
      if (parsed.success) snapshot = parsed.data;
    } catch {
      /* Storage can be unavailable without blocking exports. */
    }
    super(snapshot);
  }
  override key(payload: unknown, generate = () => crypto.randomUUID()) {
    const key = super.key(payload, generate);
    try {
      sessionStorage.setItem(this.storageKey, JSON.stringify(this.snapshot()));
    } catch {}
    return key;
  }
  override complete() {
    super.complete();
    try {
      sessionStorage.removeItem(this.storageKey);
    } catch {}
  }
}
