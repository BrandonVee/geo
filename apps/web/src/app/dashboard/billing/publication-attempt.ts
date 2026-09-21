/** A failed request retains its key; only an acknowledged outcome releases it. */
export class PublicationAttempt {
  private current?: { fingerprint: string; key: string };
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
