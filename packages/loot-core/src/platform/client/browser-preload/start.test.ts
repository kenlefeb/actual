import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startBrowserBackend } from './start';

vi.mock('absurd-sql/dist/indexeddb-main-thread', () => ({
  initBackend: vi.fn(),
}));

// fork: sc-4942. WebKit never makes a custom scheme cross-origin isolated, so
// the SwiftUI Mac app, like the Capacitor app, runs the engine in a direct
// Worker in the SharedArrayBuffer fallback mode.
describe('startBrowserBackend fallback mode', () => {
  class FakeWorker {
    static created: FakeWorker[] = [];
    posted: Array<Record<string, unknown>> = [];
    constructor() {
      FakeWorker.created.push(this);
    }
    postMessage(message: Record<string, unknown>) {
      this.posted.push(message);
    }
    addEventListener() {
      // absurd-sql's main-thread helper listens here; nothing to do
    }
  }

  const backendWorkerUrl = new URL('http://localhost/browser-server.js');
  const initPayload = { version: 'test', isDev: false };

  beforeEach(() => {
    FakeWorker.created = [];
    vi.stubGlobal('Worker', FakeWorker);
    // As in WebKit on a custom scheme: no cross-origin isolation
    vi.stubGlobal('SharedArrayBuffer', undefined);
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  function initMessage() {
    return FakeWorker.created[0].posted[0];
  }

  it('turns the fallback mode on when the shell asks for it', () => {
    startBrowserBackend({
      backendWorkerUrl,
      initPayload,
      forceDirectWorker: true,
      sharedArrayBufferFallback: true,
    });
    expect(FakeWorker.created).toHaveLength(1);
    expect(initMessage().isSharedArrayBufferOverrideEnabled).toBe('true');
  });

  it('leaves a browser page as it was', () => {
    startBrowserBackend({ backendWorkerUrl, initPayload });
    expect(initMessage().isSharedArrayBufferOverrideEnabled).toBeNull();
  });

  it('still turns it on inside Capacitor', () => {
    vi.stubGlobal('Capacitor', {});
    startBrowserBackend({ backendWorkerUrl, initPayload });
    expect(initMessage().isSharedArrayBufferOverrideEnabled).toBe('true');
  });
});
