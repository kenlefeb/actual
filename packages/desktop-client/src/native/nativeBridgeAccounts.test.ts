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
  it('lists the two reads and none of the group 2 writes yet', () => {
    expect(allowlist).toEqual(
      expect.arrayContaining([
        'native/accounts-list',
        'native/account-register',
      ]),
    );
    expect(allowlist).not.toContain('account-reopen');
    expect(allowlist).not.toContain('transactions-batch-update');
  });

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
});
