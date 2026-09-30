/** A failed request retains its key; only an acknowledged outcome releases it. */
export class PublicationAttempt {
  private current?: { fingerprint: string; key: string };
  constructor(current?: { fingerprint: string; key: string }) {
    this.current = current;
  }
  snapshot() {
    return this.current;
  }
  key(payload: unknown, generate = () => crypto.randomUUID()): string {
    const fingerprint = JSON.stringify(payload);
    if (this.current?.fingerprint !== fingerprint)
      this.current = { fingerprint, key: generate() };
    return this.current.key;
  }
  complete() {
    this.current = undefined;
  }
}
