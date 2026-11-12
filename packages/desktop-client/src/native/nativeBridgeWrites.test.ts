import { createNativeBridge } from './nativeBridge';

// native-bridge: "Bridge writes are validated before loot-core runs them" and
// "The native Budget screen's write handlers are allowlisted" (sc-3769)
const snapshot = {
  month: '2026-03',
  groups: [
    {
      id: 'group-food',
      isIncome: false,
      categories: [{ id: 'cat-groceries' }],
    },
    { id: 'group-income', isIncome: true, categories: [{ id: 'cat-salary' }] },
  ],
};

function setup() {
  const send = vi.fn(async (name: string, args?: unknown) => {
    if (name === 'native/budget-month') {
      const { month } = args as { month: string };
      if (month !== '2026-03') {
        throw new Error(`native/budget-month: no budget for month ${month}`);
      }
      return snapshot;
    }
    // loot-core's write handlers resolve to undefined
    return undefined;
  });
  const bridge = createNativeBridge({
    send,
    listen: vi.fn(() => vi.fn()),
    notify: vi.fn(),
  });
  const writes = () =>
    send.mock.calls.filter(([name]) => name === 'budget/budget-amount');
  return { bridge, send, writes };
}

const valid = { category: 'cat-groceries', month: '2026-03', amount: 12500 };

describe('budget/budget-amount through the page bridge', () => {
  it('forwards a valid write with only the three fields', async () => {
    const { bridge, writes } = setup();

    await bridge.call('budget/budget-amount', { ...valid, extra: 'x' });

    expect(writes()).toEqual([['budget/budget-amount', valid]]);
  });

  // Swift needs a JSON string back; JSON.stringify(undefined) is not one
  it('answers a write that returns nothing with the JSON string null', async () => {
    const { bridge } = setup();

    await expect(bridge.call('budget/budget-amount', valid)).resolves.toBe(
      'null',
    );
  });

  it('accepts zero and a negative integer amount', async () => {
    const { bridge, writes } = setup();

    await bridge.call('budget/budget-amount', { ...valid, amount: 0 });
    await bridge.call('budget/budget-amount', { ...valid, amount: -500 });

    expect(writes()).toHaveLength(2);
  });

  it.each([
    ['a fraction', 12.5],
    ['NaN', NaN],
    ['infinity', Infinity],
    ['beyond a safe integer', 2 ** 53],
    ['a text', '12500'],
    ['null', null],
    ['missing', undefined],
  ])('refuses an amount that is %s without writing', async (_label, amount) => {
    const { bridge, writes } = setup();

    await expect(
      bridge.call('budget/budget-amount', { ...valid, amount }),
    ).rejects.toThrow('amount');
    expect(writes()).toHaveLength(0);
  });

  it.each([
    ['not YYYY-MM', '2026-3'],
    ['text', 'march'],
    ['empty', ''],
    ['a number', 202603],
    ['missing', undefined],
  ])('refuses a month that is %s without writing', async (_label, month) => {
    const { bridge, writes } = setup();

    await expect(
      bridge.call('budget/budget-amount', { ...valid, month }),
    ).rejects.toThrow('month');
    expect(writes()).toHaveLength(0);
  });

  it('refuses a month with no budget without writing', async () => {
    const { bridge, writes } = setup();

    await expect(
      bridge.call('budget/budget-amount', { ...valid, month: '2020-01' }),
    ).rejects.toThrow('no budget for month');
    expect(writes()).toHaveLength(0);
  });

  it.each([
    ['an unknown category id', 'cat-nope'],
    ['a category group id', 'group-food'],
    ['to-budget', 'to-budget'],
    // The native screen edits only expense categories, as Swift does
    ['an income category', 'cat-salary'],
    ['a number', 7],
    ['missing', undefined],
  ])('refuses %s without writing', async (_label, category) => {
    const { bridge, writes } = setup();

    await expect(
      bridge.call('budget/budget-amount', { ...valid, category }),
    ).rejects.toThrow('category');
    expect(writes()).toHaveLength(0);
  });

  it('refuses arguments that are not an object without writing', async () => {
    const { bridge, writes } = setup();

    await expect(bridge.call('budget/budget-amount', null)).rejects.toThrow();
    await expect(bridge.call('budget/budget-amount', 'x')).rejects.toThrow();
    expect(writes()).toHaveLength(0);
  });

  it('still refuses budget/set-zero', async () => {
    const { bridge, send } = setup();

    await expect(
      bridge.call('budget/set-zero', { month: '2026-03' }),
    ).rejects.toThrow('not allowlisted');
    expect(send).not.toHaveBeenCalled();
  });
});
