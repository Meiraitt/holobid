// Bounded per-connection deduplication. HTTP snapshots remain the source of truth.
export class EventGate {
  private readonly ids = new Set<string>();

  private readonly versions = new Map<string, number>();

  accept(id: string, stream: string, version?: number, snapshotVersion = -1) {
    if (!id || this.ids.has(id)) {
      return false;
    }

    this.ids.add(id);
    if (this.ids.size > 512) {
      this.ids.delete(this.ids.values().next().value!);
    }

    if (version !== undefined) {
      if (!Number.isSafeInteger(version) || version < 0) {
        return false;
      }

      const previous = Math.max(this.versions.get(stream) ?? -1, snapshotVersion);

      if (version <= previous) {
        return false;
      }

      this.versions.delete(stream);
      this.versions.set(stream, version);
      if (this.versions.size > 256) {
        this.versions.delete(this.versions.keys().next().value!);
      }
    }

    return true;
  }
}
