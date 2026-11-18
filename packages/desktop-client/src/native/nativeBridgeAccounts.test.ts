import allowlist from '#data/native-bridge-allowlist.json';

import { createNativeBridge } from './nativeBridge';

// native-accounts-screen / native-bridge: "The accounts handlers are
// allowlisted" (sc-4386). loot-core checks each call; the page forwards only
// each read's own fields, and never a page size.
function setup() {
  const send = vi.fn(async () => undefined);
  const bridge = createNativeBridge({
    send,
    listen: vi.fn(() => vi.fn()),
    notify: vi.fn(),
  });
  return { bridge, send };
}

describe('accounts reads through the page bridge', () => {
  it('lists the two reads and the four writes, but not the raw reopen or batch update', () => {
    expect(allowlist).toEqual(
      expect.arrayContaining([
        'native/accounts-list',
        'native/account-register',
        'native/transactions-categorize',
        'native/transactions-delete',
        'native/account-reopen',
        'native/account-move',
      ]),
    );
    expect(allowlist).not.toContain('account-reopen');
    expect(allowlist).not.toContain('account-move');
    expect(allowlist).not.toContain('transactions-batch-update');
  });

  it.each(['account-reopen', 'account-move', 'transactions-batch-update'])(
    'refuses the raw %s',
    async name => {
      const { bridge, send } = setup();
      await expect(bridge.call(name, { id: 'a' })).rejects.toThrow(
        /not allowlisted/,
      );
      expect(send).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'native/transactions-categorize',
      {
        account_id: 'a',
        ids: ['t'],
        category: 'c',
        confirmedReconciled: true,
        undoToken: 'T',
        extra: 1,
      },
      {
        account_id: 'a',
        ids: ['t'],
        category: 'c',
        confirmedReconciled: true,
        undoToken: 'T',
      },
    ],
    [
      'native/transactions-delete',
      { account_id: 'a', ids: ['t'], undoToken: 'T', limit: 9 },
      { account_id: 'a', ids: ['t'], undoToken: 'T' },
    ],
    [
      'native/account-reopen',
      { id: 'a', undoToken: 'T', extra: 1 },
      { id: 'a', undoToken: 'T' },
    ],
    [
      'native/account-move',
      { id: 'a', targetId: null, undoToken: 'T', extra: 1 },
      { id: 'a', targetId: null, undoToken: 'T' },
    ],
  ])(
    'forwards %s with only its own fields and needs the undo token',
    async (name, args, forwarded) => {
      const { bridge, send } = setup();
      await bridge.call(name, args);
      expect(send).toHaveBeenCalledWith(name, forwarded);
      const { undoToken: _omitted, ...tokenless } = args;
      await expect(bridge.call(name, tokenless)).rejects.toThrow(/undo token/);
      expect(send).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['native/accounts-list', { extra: 1 }, undefined],
    [
      'native/account-register',
      {
        account_id: 'a',
        scope: 'all',
        search: 'x',
        cursor: 'c',
        limit: 5000,
        extra: 1,
      },
      { account_id: 'a', scope: 'all', search: 'x', cursor: 'c' },
    ],
  ])('forwards %s with only its own fields', async (name, args, forwarded) => {
    const { bridge, send } = setup();
    await bridge.call(name, args);
    expect(send).toHaveBeenCalledWith(name, forwarded);
  });

  // sc-3611: the search footer's count and total reach native code as loot-core sent them
  it('returns the register read whole, with its result count and total', async () => {
    const read = {
      rows: [],
      nextCursor: null,
      resultCount: 32,
      resultTotal: -12345,
    };
    const { bridge, send } = setup();
    send.mockResolvedValueOnce(read as never);
    const result = await bridge.call('native/account-register', {
      account_id: 'a',
      scope: 'all',
      search: 'x',
      cursor: null,
    });
    expect(
      JSON.parse(typeof result === 'string' ? result : JSON.stringify(result)),
    ).toEqual(read);
  });
});
