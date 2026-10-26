// Cache only successful small responses. Expired data is never used for publication.
export class CatalogCache<T> {
  private readonly entries = new Map<string, { data: T; expiresAt: number }>();
  constructor(private readonly ttl = 300_000, private readonly capacity = 100) {}
  get(key: string, now = Date.now()): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) { this.entries.delete(key); return undefined; }
    return entry.data;
  }
  set(key: string, data: T, now = Date.now()): void {
    this.entries.delete(key);
    if (this.entries.size >= this.capacity) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, { data, expiresAt: now + this.ttl });
  }
}
