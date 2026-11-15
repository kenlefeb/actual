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

// sc-4343: the editor's reads and writes
function editorSetup() {
  const send = vi.fn(async (name: string) => {
    if (name === 'paychecks-get') {
      return [{ id: 'acme', name: 'Acme', definition: {} }];
    }
    if (name === 'accounts-get') {
      return ['clearing', 'checking', 'savings', 'retirement'].map(id => ({
        id,
      }));
    }
    return 'ok';
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

const definition = {
  payee: 'acme-payee',
  clearingAccount: 'clearing',
  date: { start: '2026-11-01', frequency: 'monthly' },
  weekendSolveMode: 'before',
  grossAmount: 300000,
  incomeCategory: null,
  deductions: [
    { id: 'k', name: '401k', amount: 100, transferAccount: 'retirement' },
  ],
  deposits: [{ id: 'd', account: 'checking', kind: 'remainder', value: 0 }],
};

const saveArgs = {
  id: 'acme',
  name: 'Acme',
  definition,
  daysEarly: { checking: 2 },
  undoToken: 'S',
};

describe('paycheck editor handlers through the page bridge', () => {
  it('lists the preview, year-to-date, save and delete', () => {
    expect(allowlist).toEqual(
      expect.arrayContaining([
        'native/paycheck-preview',
        'paycheck-year-to-date',
        'native/paycheck-save',
        'paycheck-delete',
      ]),
    );
    for (const name of [
      'paycheck-create',
      'paycheck-update',
      'account-set-business-days',
    ]) {
      expect(allowlist).not.toContain(name);
    }
  });

  it('forwards a preview with only the draft fields', async () => {
    const { bridge, calls } = editorSetup();
    await bridge.call('native/paycheck-preview', {
      name: 'Acme',
      definition,
      isNewAccount: false,
      newClearingAccountName: '',
      daysEarly: {},
      extra: 'x',
    });
    expect(calls('native/paycheck-preview')).toEqual([
      [
        'native/paycheck-preview',
        {
          name: 'Acme',
          definition,
          isNewAccount: false,
          newClearingAccountName: '',
          daysEarly: {},
        },
      ],
    ]);
  });

  it('reads year-to-date only for a live paycheck', async () => {
    const { bridge, calls } = editorSetup();
    await bridge.call('paycheck-year-to-date', { id: 'acme', extra: 1 });
    await expect(
      bridge.call('paycheck-year-to-date', { id: 'gone' }),
    ).rejects.toThrow(/paycheck/);
    expect(calls('paycheck-year-to-date')).toEqual([
      ['paycheck-year-to-date', { id: 'acme' }],
    ]);
  });

  it('forwards a delete of a live paycheck with only its id and token', async () => {
    const { bridge, calls } = editorSetup();
    await bridge.call('paycheck-delete', { id: 'acme', undoToken: 'D', x: 1 });
    expect(calls('paycheck-delete')).toEqual([
      ['paycheck-delete', { id: 'acme', undoToken: 'D' }],
    ]);
  });

  it('refuses a delete of an unknown id or without a token', async () => {
    const { bridge, calls } = editorSetup();
    await expect(
      bridge.call('paycheck-delete', { id: 'gone', undoToken: 'D' }),
    ).rejects.toThrow(/paycheck/);
    await expect(bridge.call('paycheck-delete', { id: 'acme' })).rejects.toThrow(
      /token/,
    );
    expect(calls('paycheck-delete')).toEqual([]);
  });

  it('forwards a save with only its fields', async () => {
    const { bridge, calls } = editorSetup();
    await bridge.call('native/paycheck-save', { ...saveArgs, extra: 'x' });
    expect(calls('native/paycheck-save')).toEqual([
      ['native/paycheck-save', saveArgs],
    ]);
  });

  it('forwards a new paycheck that creates its clearing account', async () => {
    const { bridge, calls } = editorSetup();
    const args = {
      name: 'Acme',
      definition: { ...definition, clearingAccount: '' },
      newClearingAccountName: 'Acme Paycheck',
      daysEarly: {},
      undoToken: 'N',
    };
    await bridge.call('native/paycheck-save', args);
    expect(calls('native/paycheck-save')).toEqual([
      ['native/paycheck-save', args],
    ]);
  });

  it.each([
    ['an unknown paycheck', { ...saveArgs, id: 'gone' }, /paycheck/],
    ['no token', { ...saveArgs, undoToken: '' }, /token/],
    [
      'an unknown clearing account',
      { ...saveArgs, definition: { ...definition, clearingAccount: 'x' } },
      /account/,
    ],
    [
      'an unknown deposit account',
      {
        ...saveArgs,
        definition: {
          ...definition,
          deposits: [{ id: 'd', account: 'x', kind: 'remainder', value: 0 }],
        },
      },
      /account/,
    ],
    [
      'an unknown transfer account',
      {
        ...saveArgs,
        definition: {
          ...definition,
          deductions: [{ id: 'k', name: 'k', amount: 1, transferAccount: 'x' }],
        },
      },
      /account/,
    ],
    ['days early for an unknown account', { ...saveArgs, daysEarly: { x: 1 } }, /account/],
    ['a non-integer days early', { ...saveArgs, daysEarly: { checking: 1.5 } }, /days early/],
    ['a missing definition', { ...saveArgs, definition: null }, /definition/],
  ])('refuses a save with %s', async (_, args, message) => {
    const { bridge, calls } = editorSetup();
    await expect(bridge.call('native/paycheck-save', args)).rejects.toThrow(
      message,
    );
    expect(calls('native/paycheck-save')).toEqual([]);
  });
});
