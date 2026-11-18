import allowlist from '#data/native-bridge-allowlist.json';

import { createNativeBridge } from './nativeBridge';

// native-add-transaction / native-bridge: "The transaction handlers are
// allowlisted with listed fields" (sc-3602). loot-core checks the draft; the
// page forwards only each call's own fields.
function setup() {
  const send = vi.fn(async () => undefined);
  const bridge = createNativeBridge({
    send,
    listen: vi.fn(() => vi.fn()),
    notify: vi.fn(),
  });
  return { bridge, send };
}

describe('the Add transaction calls through the page bridge', () => {
  it('lists the form, the payee search, the preview and the save', () => {
    expect(allowlist).toEqual(
      expect.arrayContaining([
        'native/transaction-form',
        'native/payees',
        'native/transaction-preview',
        'native/transaction-save',
      ]),
    );
  });

  it.each([
    'transactions-batch-update',
    'transaction-add',
    'rules-run',
    'payee-create',
  ])('refuses the raw %s', async name => {
    const { bridge, send } = setup();
    expect(allowlist).not.toContain(name);
    await expect(bridge.call(name, { id: 'a' })).rejects.toThrow(
      /not allowlisted/,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    [
      'native/transaction-form',
      { id: 't', account_id: 'a', limit: 9, extra: 1 },
      { id: 't', account_id: 'a' },
    ],
    ['native/payees', { search: 'co', limit: 5000 }, { search: 'co' }],
    [
      'native/transaction-preview',
      {
        draft: { account: 'a' },
        changedField: 'payee',
        learnCategories: false,
        extra: 1,
      },
      // PR 453: the preview takes the draft only
      { draft: { account: 'a' } },
    ],
    // The save reads learn-categories from the budget, never from the call
    [
      'native/transaction-save',
      {
        draft: { account: 'a' },
        previewDigest: 'p',
        digest: 'd',
        undoToken: 'T',
        confirmedReconciled: true,
        learnCategories: false,
        extra: 1,
      },
      {
        draft: { account: 'a' },
        previewDigest: 'p',
        digest: 'd',
        undoToken: 'T',
        confirmedReconciled: true,
      },
    ],
  ])('forwards %s with only its own fields', async (name, args, forwarded) => {
    const { bridge, send } = setup();
    await bridge.call(name, args);
    expect(send).toHaveBeenCalledWith(name, forwarded);
  });
});
