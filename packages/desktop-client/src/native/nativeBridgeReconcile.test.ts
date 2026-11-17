import allowlist from '#data/native-bridge-allowlist.json';

import { createNativeBridge } from './nativeBridge';

// native-bridge: "The reconcile handlers are allowlisted" (sc-4801). loot-core
// checks each call; the page forwards only each handler's own fields.
function setup() {
  const send = vi.fn(async () => undefined);
  const bridge = createNativeBridge({
    send,
    listen: vi.fn(() => vi.fn()),
    notify: vi.fn(),
  });
  return { bridge, send };
}

const RECONCILE = [
  'native/reconcile-month',
  'native/reconcile-rows',
  'native/reconcile-tick',
  'native/reconcile-list-set',
  'account-statement-balance-prefill',
  'account-statement-balance-save',
  'account-statement-balance-get',
  // sc-4825
  'native/reconcile-matches',
  'native/reconcile-lock-preview',
  'native/reconcile-adjust',
  'native/reconcile-lock',
];

describe('reconcile handlers through the page bridge', () => {
  it('lists the seven reconcile handlers and not the consume', () => {
    expect(allowlist).toEqual(expect.arrayContaining(RECONCILE));
    expect(allowlist).not.toContain('account-statement-balance-consume');
  });

  it.each([
    ['native/reconcile-month', { extra: 1 }, undefined],
    [
      'native/reconcile-rows',
      { account_id: 'a', scope: 'all', search: '41.80', extra: 1 },
      { account_id: 'a', scope: 'all', search: '41.80' },
    ],
    [
      'native/reconcile-matches',
      { account_id: 'a', extra: 1 },
      { account_id: 'a' },
    ],
    [
      'native/reconcile-lock-preview',
      { account_id: 'a', extra: 1 },
      { account_id: 'a' },
    ],
    [
      'native/reconcile-adjust',
      {
        account_id: 'a',
        amount: 4180,
        category_id: 'c',
        label: 'Adjustment',
        undoToken: 'T',
        date: '2001-01-01',
      },
      {
        account_id: 'a',
        amount: 4180,
        category_id: 'c',
        label: 'Adjustment',
        undoToken: 'T',
      },
    ],
    [
      'native/reconcile-lock',
      { account_id: 'a', plan_digest: 'd', ids: ['x'] },
      { account_id: 'a', plan_digest: 'd' },
    ],
    [
      'native/reconcile-tick',
      { account_id: 'a', ids: ['t'], cleared: true, undoToken: 'T', extra: 1 },
      { account_id: 'a', ids: ['t'], cleared: true, undoToken: 'T' },
    ],
    [
      'native/reconcile-list-set',
      { excluded: ['a'], extra: 1 },
      { excluded: ['a'] },
    ],
    [
      'account-statement-balance-prefill',
      { account_id: 'a', extra: 1 },
      { account_id: 'a' },
    ],
    [
      'account-statement-balance-get',
      { account_id: 'a', extra: 1 },
      { account_id: 'a' },
    ],
    [
      'account-statement-balance-save',
      {
        account_id: 'a',
        amount: 5,
        source: 'entered',
        as_of: null,
        entered_by: 'someone else',
      },
      { account_id: 'a', amount: 5, source: 'entered', as_of: null },
    ],
  ])('forwards %s with only its fields', async (name, args, forwarded) => {
    const { bridge, send } = setup();
    await bridge.call(name, args);
    expect(send).toHaveBeenCalledWith(name, forwarded);
  });

  it('refuses an adjustment without its undo token', async () => {
    const { bridge, send } = setup();
    await expect(
      bridge.call('native/reconcile-adjust', {
        account_id: 'a',
        amount: 1,
        label: 'x',
      }),
    ).rejects.toThrow(/undo token/);
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a tick without its undo token', async () => {
    const { bridge, send } = setup();
    await expect(
      bridge.call('native/reconcile-tick', {
        account_id: 'a',
        ids: ['t'],
        cleared: true,
      }),
    ).rejects.toThrow(/undo token/);
    expect(send).not.toHaveBeenCalled();
  });
});
