import * as connection from '@actual-app/core/platform/client/connection';

import allowlist from '#data/native-bridge-allowlist.json';

import {
  createNativeBridge,
  installNativeBridge,
  isNativeRead,
} from './nativeBridge';

// native-bridge: "The bridge forwards only allowlisted handlers" and
// "Native views re-read on change events" (sc-3584)
function setup() {
  const send = vi.fn(async (name: string) => ({ handled: name }));
  const listeners = new Map<string, (payload: unknown) => void>();
  const listen = vi.fn((name: string, cb: (payload: unknown) => void) => {
    listeners.set(name, cb);
    return () => listeners.delete(name);
  });
  const notify = vi.fn();
  const bridge = createNativeBridge({ send, listen, notify });
  return { bridge, send, listeners, notify };
}

describe('createNativeBridge', () => {
  it('forwards an allowlisted handler and returns its result as JSON', async () => {
    const { bridge, send } = setup();

    const json = await bridge.call('native/budget-month', { month: '2026-03' });

    expect(send).toHaveBeenCalledWith('native/budget-month', {
      month: '2026-03',
    });
    expect(JSON.parse(json)).toEqual({ handled: 'native/budget-month' });
  });

  it('refuses a handler off the allowlist without calling loot-core', async () => {
    const { bridge, send } = setup();

    await expect(bridge.call('delete-budget', { id: 'x' })).rejects.toThrow(
      'delete-budget',
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('forwards cells-changed and sync-event to native code', () => {
    const { listeners, notify } = setup();

    listeners.get('cells-changed')?.([{ sheet: 'budget202603', name: 'x' }]);
    listeners.get('sync-event')?.({ type: 'success' });

    expect(notify).toHaveBeenCalledWith({
      event: 'cells-changed',
      payload: [{ sheet: 'budget202603', name: 'x' }],
    });
    expect(notify).toHaveBeenCalledWith({
      event: 'sync-event',
      payload: { type: 'success' },
    });
  });
});

// native-durable-writes D3, D5, D7a, D10 (sc-5219)
describe('storage through the page bridge', () => {
  const healthy = { failed: false, lastStoredFlushAt: 1000, quota: false };
  const failed = { failed: true, lastStoredFlushAt: 500, quota: true };

  function storageSetup(state: unknown = healthy) {
    const send = vi.fn(async (name: string, _args?: unknown) => {
      if (name === 'native/storage-state') {
        if (state instanceof Error) throw state;
        return state;
      }
      return null;
    });
    const listeners = new Map<string, (payload: unknown) => void>();
    const listen = (name: string, cb: (payload: unknown) => void) => {
      listeners.set(name, cb);
      return () => listeners.delete(name);
    };
    const notify = vi.fn();
    const bridge = createNativeBridge({ send, listen, notify });
    return { bridge, send, listeners, notify };
  }

  const WRITES = [
    'budget/budget-amount',
    'budget/transfer-category',
    'budget/transfer-available',
    'paycheck-skip-next',
    'native/undo',
    'native/paycheck-save',
    'paycheck-delete',
    'native/reconcile-tick',
    'native/reconcile-list-set',
    'account-statement-balance-save',
    'native/reconcile-adjust',
    'native/reconcile-lock',
    'native/transactions-categorize',
    'native/transactions-delete',
    'native/account-reopen',
    'native/account-move',
    'native/transaction-save',
    'native/settings-save',
  ];

  it.each(WRITES)('refuses %s once storage has failed', async name => {
    const { bridge, send } = storageSetup(failed);
    await expect(bridge.call(name, {})).rejects.toThrow(
      /^\[native:not-stored\] /,
    );
    expect(send.mock.calls).toEqual([['native/storage-state']]);
  });

  it('counts every allowlisted name that is not a listed read as a write', () => {
    expect(allowlist.filter(name => !isNativeRead(name)).sort()).toEqual(
      [...WRITES].sort(),
    );
  });

  it('checks storage before validating or forwarding a write, and does not wait', async () => {
    const { bridge, send } = storageSetup();
    await bridge.call('native/undo', { token: 't' });
    expect(send.mock.calls).toEqual([
      ['native/storage-state'],
      ['native/undo', { token: 't' }],
    ]);
  });

  it('does not stop reads or sync after a failure', async () => {
    const { bridge, send } = storageSetup(failed);
    await bridge.call('native/accounts-list');
    await bridge.call('sync');
    expect(send.mock.calls.map(([name]) => name)).toEqual([
      'native/accounts-list',
      'sync',
    ]);
  });

  it.each(['native/persisted', 'native/storage-state'])(
    'forwards %s with no arguments',
    async name => {
      const { bridge, send } = storageSetup();
      await bridge.call(name, { extra: 1 });
      expect(send.mock.calls).toEqual([[name, undefined]]);
    },
  );

  it('passes on only a lifecycle flush request to native/persisted', async () => {
    const { bridge, send } = storageSetup();
    await bridge.call('native/persisted', { allFiles: true, extra: 1 });
    await bridge.call('native/persisted', { allFiles: 'yes' });
    expect(send.mock.calls).toEqual([
      ['native/persisted', { allFiles: true }],
      ['native/persisted', undefined],
    ]);
  });

  // Security on PR #485: one id for this page load, on everything Swift compares
  it('stamps its own page load on storage answers and events', async () => {
    const send = vi.fn(async () => ({
      stored: false,
      seq: { epoch: 'engine', n: 4 },
    }));
    const listeners = new Map<string, (payload: unknown) => void>();
    const notify = vi.fn();
    const bridge = createNativeBridge({
      send,
      listen: (name, cb) => {
        listeners.set(name, cb);
        return () => listeners.delete(name);
      },
      notify,
      pageLoad: 'this-page',
    });
    expect(JSON.parse(await bridge.call('native/persisted'))).toEqual({
      stored: false,
      seq: { epoch: 'this-page', n: 4 },
    });
    listeners.get('storage-stored')?.({ seq: { epoch: 'engine', n: 4 } });
    expect(notify).toHaveBeenCalledWith({
      event: 'stored',
      payload: { seq: { epoch: 'this-page', n: 4 } },
    });
  });

  it('keeps the guard switch away from native code', async () => {
    const { bridge } = storageSetup();
    await expect(bridge.call('native/enable-storage-guard')).rejects.toThrow(
      'not allowlisted',
    );
  });

  it('posts storage-failed with the state of the open budget', async () => {
    const { listeners, notify } = storageSetup(failed);
    listeners.get('storage-failed')?.({ lastStoredFlushAt: 1, quota: false });
    await vi.waitFor(() =>
      expect(notify).toHaveBeenCalledWith({
        event: 'storage-failed',
        payload: { lastStoredFlushAt: 500, quota: true },
      }),
    );
  });

  it('posts nothing when the open budget has not failed', async () => {
    const { listeners, notify, send } = storageSetup();
    listeners.get('storage-failed')?.({ lastStoredFlushAt: 1, quota: false });
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    await Promise.resolve();
    expect(notify).not.toHaveBeenCalled();
  });

  it('still posts the failure if the state cannot be read', async () => {
    const { listeners, notify } = storageSetup(new Error('gone'));
    const payload = { lastStoredFlushAt: 1, quota: false };
    listeners.get('storage-failed')?.(payload);
    await vi.waitFor(() =>
      expect(notify).toHaveBeenCalledWith({ event: 'storage-failed', payload }),
    );
  });

  it('forwards storage-stored as stored, and a closed budget failure', () => {
    const { listeners, notify } = storageSetup();
    listeners.get('storage-stored')?.({ other: 3 });
    listeners.get('storage-close-failed')?.(undefined);
    expect(notify.mock.calls).toEqual([
      [{ event: 'stored', payload: { other: 3 } }],
      [{ event: 'storage-close-failed', payload: undefined }],
    ]);
  });

  describe('the barrier test hook', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('turns the barrier off only with the build constant', async () => {
      vi.stubGlobal('__forkTestBarrierOff', true);
      const off = storageSetup(failed);
      await expect(off.bridge.call('native/undo', {})).rejects.toThrow(
        /not-stored/,
      );

      vi.stubGlobal('__FORK_TEST_HOOKS__', true);
      const on = storageSetup(failed);
      await on.bridge.call('native/undo', { token: 't' });
      expect(await on.bridge.call('native/persisted')).toBe('{"stored":true}');
      expect(on.send.mock.calls).toEqual([['native/undo', { token: 't' }]]);
    });
  });
});

describe('installNativeBridge', () => {
  it('does nothing outside the iOS app', () => {
    const sent = vi.spyOn(connection, 'send');
    const win: Parameters<typeof installNativeBridge>[0] = {};
    installNativeBridge(win);
    expect(win.__actualNativeBridge).toBeUndefined();
    expect(sent).not.toHaveBeenCalled();
    sent.mockRestore();
  });

  // Task 2.5 (D7a): a shell that has opted in turns the guard on as the bridge
  // installs, before it tells native code it is ready, so before any budget opens
  it('turns the storage guard on as it installs when the shell opts in', () => {
    const order: string[] = [];
    const sent = vi.spyOn(connection, 'send').mockImplementation((async (
      name: string,
    ) => {
      order.push(name);
    }) as never);
    const postMessage = vi.fn((message: { event: string }) => {
      order.push(message.event);
    });
    installNativeBridge({
      webkit: { messageHandlers: { actualNativeBridge: { postMessage } } },
      __actualNativeShell: { storageGuard: true },
    });
    expect(sent).toHaveBeenCalledWith('native/enable-storage-guard');
    expect(order).toEqual(['native/enable-storage-guard', 'ready']);
    sent.mockRestore();
  });

  // A shell that hasn't opted in (the Mac until sc-5344) stays stock
  it('leaves the storage guard off when the shell has not opted in', () => {
    const sent = vi
      .spyOn(connection, 'send')
      .mockResolvedValue(undefined as never);
    for (const shell of [
      undefined,
      {},
      { storageGuard: false },
      { storageGuard: 'yes' },
    ]) {
      installNativeBridge({
        webkit: {
          messageHandlers: { actualNativeBridge: { postMessage: vi.fn() } },
        },
        __actualNativeShell: shell as { storageGuard?: boolean } | undefined,
      });
    }
    expect(sent).not.toHaveBeenCalled();
    sent.mockRestore();
  });

  // Security's mismatch check (sc-5219): "ready" says whether this page turned
  // the guard on, so native code can compare it with its own opt-in
  it('says in ready whether it turned the storage guard on', () => {
    const sent = vi
      .spyOn(connection, 'send')
      .mockResolvedValue(undefined as never);
    for (const [shell, storageGuard] of [
      [{ storageGuard: true }, true],
      [{ storageGuard: 'yes' }, false],
      [undefined, false],
    ] as const) {
      const postMessage = vi.fn();
      installNativeBridge({
        webkit: { messageHandlers: { actualNativeBridge: { postMessage } } },
        __actualNativeShell: shell as { storageGuard?: boolean } | undefined,
      });
      expect(postMessage).toHaveBeenCalledWith({
        event: 'ready',
        payload: { epoch: expect.any(String), storageGuard },
      });
    }
    sent.mockRestore();
  });

  it('installs the bridge when the native message handler is present', () => {
    const postMessage = vi.fn();
    const win: Parameters<typeof installNativeBridge>[0] = {
      webkit: { messageHandlers: { actualNativeBridge: { postMessage } } },
    };
    installNativeBridge(win);
    expect(win.__actualNativeBridge?.call).toBeTypeOf('function');
  });

  // native-bridge: "Back on the app's own page" (sc-3859)
  it('tells native code it is ready once the bridge is installed', () => {
    const win: Parameters<typeof installNativeBridge>[0] = {};
    const postMessage = vi.fn(() => {
      expect(win.__actualNativeBridge).toBeDefined();
    });
    win.webkit = { messageHandlers: { actualNativeBridge: { postMessage } } };
    installNativeBridge(win);
    expect(postMessage).toHaveBeenCalledWith({
      event: 'ready',
      payload: { epoch: expect.any(String), storageGuard: false },
    });
  });
});
