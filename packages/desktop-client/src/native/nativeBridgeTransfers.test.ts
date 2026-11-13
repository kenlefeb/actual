import { createNativeBridge } from './nativeBridge';

// native-bridge: "Transfers follow the move-money rules" and "The native
// Budget screen's write handlers are allowlisted" (sc-3787)
const snapshot = {
  month: '2026-03',
  budgetType: 'envelope',
  currencyCode: 'USD',
  totals: { toBudget: 140000 },
  groups: [
    {
      id: 'group-food',
      isIncome: false,
      categories: [
        { id: 'cat-groceries', balance: 5000 },
        { id: 'cat-rent', balance: 30000 },
      ],
    },
    {
      id: 'group-income',
      isIncome: true,
      categories: [{ id: 'cat-salary', balance: null }],
    },
  ],
};

function setup(budgetType = 'envelope') {
  const send = vi.fn(async (name: string, args?: unknown) => {
    if (name === 'native/budget-month') {
      const { month } = args as { month: string };
      if (month !== '2026-03') {
        throw new Error(`native/budget-month: no budget for month ${month}`);
      }
      return { ...snapshot, budgetType };
    }
    return undefined;
  });
  const bridge = createNativeBridge({
    send,
    listen: vi.fn(() => vi.fn()),
    notify: vi.fn(),
  });
  const writes = () =>
    send.mock.calls.filter(([name]) => name !== 'native/budget-month');
  return { bridge, send, writes };
}

const category = {
  month: '2026-03',
  amount: 1000,
  from: 'cat-groceries',
  to: 'cat-rent',
  currencyCode: 'USD',
};
const available = { month: '2026-03', amount: 1000, category: 'cat-rent' };

describe('budget/transfer-category through the page bridge', () => {
  it('forwards a valid move between categories with only its fields', async () => {
    const { bridge, writes } = setup();

    await bridge.call('budget/transfer-category', { ...category, extra: 1 });

    expect(writes()).toEqual([['budget/transfer-category', category]]);
  });

  it('takes the currency from the month, not the caller', async () => {
    const { bridge, writes } = setup();

    await bridge.call('budget/transfer-category', {
      ...category,
      currencyCode: 'EUR',
    });

    expect(writes()).toEqual([['budget/transfer-category', category]]);
  });

  it('accepts to-budget as the destination', async () => {
    const { bridge, writes } = setup();

    await bridge.call('budget/transfer-category', {
      ...category,
      to: 'to-budget',
    });

    expect(writes()).toEqual([
      ['budget/transfer-category', { ...category, to: 'to-budget' }],
    ]);
  });

  it('accepts the whole balance of the source', async () => {
    const { bridge, writes } = setup();

    await bridge.call('budget/transfer-category', {
      ...category,
      amount: 5000,
    });

    expect(writes()).toHaveLength(1);
  });

  // loot-core's transferCategory would write a budget row for a category
  // called to-budget; a move out of to-budget is budget/transfer-available
  it.each([
    ['to-budget as the source', { from: 'to-budget' }],
    ['the same source and destination', { to: 'cat-groceries' }],
    ['an amount of 0', { amount: 0 }],
    ['a negative amount', { amount: -1 }],
    ['a fractional amount', { amount: 1.5 }],
    ['a text amount', { amount: '1000' }],
    ['more than the source holds', { amount: 5001 }],
    ['an income source', { from: 'cat-salary' }],
    ['an income destination', { to: 'cat-salary' }],
    ['a group id as the source', { from: 'group-food' }],
    ['a group id as the destination', { to: 'group-food' }],
    ['an unknown destination', { to: 'cat-nope' }],
    ['a malformed month', { month: '2026-3' }],
    ['a month with no budget', { month: '2020-01' }],
  ])('refuses %s without writing', async (_label, change) => {
    const { bridge, writes } = setup();

    await expect(
      bridge.call('budget/transfer-category', { ...category, ...change }),
    ).rejects.toThrow();
    expect(writes()).toHaveLength(0);
  });

  it('refuses a move on a tracking budget without writing', async () => {
    const { bridge, writes } = setup('tracking');

    await expect(
      bridge.call('budget/transfer-category', category),
    ).rejects.toThrow('envelope');
    expect(writes()).toHaveLength(0);
  });
});

describe('budget/transfer-available through the page bridge', () => {
  it('forwards a valid move from to-budget with only its fields', async () => {
    const { bridge, writes } = setup();

    await bridge.call('budget/transfer-available', { ...available, x: 1 });

    expect(writes()).toEqual([['budget/transfer-available', available]]);
  });

  it('accepts the whole to-budget', async () => {
    const { bridge, writes } = setup();

    await bridge.call('budget/transfer-available', {
      ...available,
      amount: 140000,
    });

    expect(writes()).toHaveLength(1);
  });

  it.each([
    ['an amount of 0', { amount: 0 }],
    ['a negative amount', { amount: -1 }],
    ['more than to-budget', { amount: 140001 }],
    ['to-budget as the category', { category: 'to-budget' }],
    ['an income category', { category: 'cat-salary' }],
    ['a group id', { category: 'group-food' }],
    ['a month with no budget', { month: '2020-01' }],
  ])('refuses %s without writing', async (_label, change) => {
    const { bridge, writes } = setup();

    await expect(
      bridge.call('budget/transfer-available', { ...available, ...change }),
    ).rejects.toThrow();
    expect(writes()).toHaveLength(0);
  });

  it('refuses to-budget sent as the category of budget/budget-amount', async () => {
    const { bridge, writes } = setup();

    await expect(
      bridge.call('budget/budget-amount', {
        month: '2026-03',
        amount: 1,
        category: 'to-budget',
      }),
    ).rejects.toThrow('category');
    expect(writes()).toHaveLength(0);
  });

  it('still refuses budget/cover-overspending', async () => {
    const { bridge, send } = setup();

    await expect(
      bridge.call('budget/cover-overspending', { month: '2026-03' }),
    ).rejects.toThrow('not allowlisted');
    expect(send).not.toHaveBeenCalled();
  });
});
