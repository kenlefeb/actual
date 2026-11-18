declare module 'absurd-sql/dist/indexeddb-main-thread' {
  export function initBackend(worker: Worker): void;
}

// Fork (sc-5219): the patched backend, as the durable-writes test uses it
declare module 'absurd-sql/dist/indexeddb-backend' {
  export default class IndexedDBBackend {
    constructor(
      onFallbackFailure?: (state?: {
        lastStoredFlushAt: number | null;
        quota: boolean;
      }) => void,
    );
    createFile(filename: string): unknown;
  }
}
