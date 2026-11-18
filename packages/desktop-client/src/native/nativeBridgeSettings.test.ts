import allowlist from '#data/native-bridge-allowlist.json';

import { createNativeBridge } from './nativeBridge';

// native-settings-screen D2 (sc-4643): the two reads and the one save are
// allowlisted; the page forwards nothing for the reads and only `changes` and
// `undoToken` for the save, and adds the client version to the settings read.
function setup(result: unknown = undefined) {
  const send = vi.fn(async (_name: string, _args?: unknown) => result);
  const bridge = createNativeBridge({
    send,
    listen: vi.fn(() => vi.fn()),
    notify: vi.fn(),
  });
  return { bridge, send };
}

describe('settings through the page bridge', () => {
  it('lists the three settings handlers', () => {
    expect(allowlist).toEqual(
      expect.arrayContaining([
        'native/settings',
        'native/server-info',
        'native/settings-save',
      ]),
    );
  });

  it.each([
    'preferences/save',
    'save-global-prefs',
    'subscribe-sign-out',
    'set-server-url',
    'key-make',
    'reset-budget-cache',
  ])('refuses the raw %s', async name => {
    const { bridge, send } = setup();
    await expect(bridge.call(name, { id: 'x', value: 'y' })).rejects.toThrow(
      /not allowlisted/,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it.each(['native/settings', 'native/server-info'])(
    'forwards no arguments for %s',
    async name => {
      const { bridge, send } = setup({});
      await bridge.call(name, { anything: 1 });
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][0]).toBe(name);
      expect(send.mock.calls[0][1]).toBeUndefined();
    },
  );

  it('adds the client version to the settings read, and nothing else', async () => {
    window.Actual = { ...window.Actual, ACTUAL_VERSION: '26.10.1-alpha.37' };
    const { bridge } = setup({ prefs: {}, limits: [] });
    expect(JSON.parse(await bridge.call('native/settings'))).toEqual({
      prefs: {},
      limits: [],
      clientVersion: '26.10.1-alpha.37',
    });
  });

  it('forwards only changes and the undo token for the save', async () => {
    const { bridge, send } = setup();
    await bridge.call('native/settings-save', {
      changes: { dateFormat: 'yyyy-MM-dd' },
      undoToken: 'T',
      extra: 'dropped',
    });
    expect(send).toHaveBeenCalledWith('native/settings-save', {
      changes: { dateFormat: 'yyyy-MM-dd' },
      undoToken: 'T',
    });
  });

  it('needs an undo token for the save', async () => {
    const { bridge, send } = setup();
    await expect(
      bridge.call('native/settings-save', { changes: { dateFormat: 'x' } }),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});
