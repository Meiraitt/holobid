export type Operation<T> = Readonly<{ key: string; input: Readonly<T> }>;

// Keep this object for an explicit retry after a timeout or a PENDING response.
// A newly confirmed user intent creates a new operation, never an automatic retry.
export function createOperation<T extends object>(input: T): Operation<T> {
  return Object.freeze({ key: crypto.randomUUID(), input: Object.freeze(structuredClone(input)) });
}
