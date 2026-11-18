declare module 'absurd-sql/dist/indexeddb-main-thread' {
  export function initBackend(worker: Worker): void;
}

// Fork (sc-5219): the patched backend, as the durable-writes test uses it
declare module 'absurd-sql/dist/indexeddb-backend' {
  export default class IndexedDBBackend {
    constructor(
      // No arguments: the stock safety check refused a write. With the state:
      // the guard is on and a write failed
      onFallbackFailure?: (
        state?: { lastStoredFlushAt: number | null; quota: boolean },
        ops?: unknown,
      ) => void,
    );
    files: Set<unknown>;
    enableLatch(): void;
    createFile(filename: string): unknown;
  }
}
