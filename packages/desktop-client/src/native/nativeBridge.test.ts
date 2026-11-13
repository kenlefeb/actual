import { createNativeBridge, installNativeBridge } from './nativeBridge';

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

describe('installNativeBridge', () => {
  it('does nothing outside the iOS app', () => {
    const win: Parameters<typeof installNativeBridge>[0] = {};
    installNativeBridge(win);
    expect(win.__actualNativeBridge).toBeUndefined();
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
    expect(postMessage).toHaveBeenCalledWith({ event: 'ready', payload: null });
  });
});
