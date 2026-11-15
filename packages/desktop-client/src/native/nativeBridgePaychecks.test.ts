import allowlist from '#data/native-bridge-allowlist.json';

import { createNativeBridge } from './nativeBridge';

// native-bridge: "The paycheck handlers are allowlisted" and "Native Undo
// reverses only the native write it names" (sc-4341)
function setup() {
  const send = vi.fn(async (name: string) => {
    if (name === 'paychecks-get') {
      return [{ id: 'acme', name: 'Acme', definition: {} }];
    }
    return undefined;
  });
  const bridge = createNativeBridge({
    send,
    listen: vi.fn(() => vi.fn()),
    notify: vi.fn(),
  });
  const calls = (handler: string) =>
    send.mock.calls.filter(([name]) => name === handler);
  return { bridge, send, calls };
}

describe('paycheck handlers through the page bridge', () => {
  it('lists the read, the skip and native/undo, never bare undo or redo', () => {
    expect(allowlist).toEqual(
      expect.arrayContaining([
        'native/schedules-paychecks',
        'paycheck-skip-next',
        'native/undo',
      ]),
    );
    expect(allowlist).not.toContain('undo');
    expect(allowlist).not.toContain('redo');
  });

  it('forwards a skip of a live paycheck with only its id and token', async () => {
    const { bridge, calls } = setup();

    await bridge.call('paycheck-skip-next', {
      id: 'acme',
      undoToken: 'T',
      extra: 'x',
    });

    expect(calls('paycheck-skip-next')).toEqual([
      ['paycheck-skip-next', { id: 'acme', undoToken: 'T' }],
    ]);
  });

  it('refuses a skip of an id a fresh paychecks-get does not list', async () => {
    const { bridge, calls } = setup();

    await expect(
      bridge.call('paycheck-skip-next', { id: 'gone', undoToken: 'T' }),
    ).rejects.toThrow(/paycheck/);

    expect(calls('paychecks-get')).toHaveLength(1);
    expect(calls('paycheck-skip-next')).toEqual([]);
  });

  it('refuses a skip without a token', async () => {
    const { bridge, calls } = setup();

    await expect(
      bridge.call('paycheck-skip-next', { id: 'acme' }),
    ).rejects.toThrow(/token/);
    expect(calls('paycheck-skip-next')).toEqual([]);
  });

  it('forwards native/undo with only its token', async () => {
    const { bridge, calls } = setup();

    await bridge.call('native/undo', { token: 'T', id: 'x' });

    expect(calls('native/undo')).toEqual([['native/undo', { token: 'T' }]]);
  });

  it('refuses native/undo without a token', async () => {
    const { bridge, calls } = setup();

    await expect(bridge.call('native/undo', {})).rejects.toThrow(/token/);
    expect(calls('native/undo')).toEqual([]);
  });

  it('refuses bare undo and redo without calling loot-core', async () => {
    const { bridge, send } = setup();

    await expect(bridge.call('undo')).rejects.toThrow(/not allowlisted/);
    await expect(bridge.call('redo')).rejects.toThrow(/not allowlisted/);
    expect(send).not.toHaveBeenCalled();
  });
});
