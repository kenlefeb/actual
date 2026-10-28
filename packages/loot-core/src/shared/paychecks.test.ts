import type { PaycheckDeposit } from '#types/models';

import { computePaycheck } from './paychecks';

const deductions = [
  { id: 'tax', name: 'Federal tax', amount: 45000, category: 'taxes' },
  { id: 'health', name: 'Health', amount: 12000, category: 'insurance' },
  { id: '401k', name: '401(k)', amount: 18000, transferAccount: 'retirement' },
];

const deposit = (
  id: string,
  kind: PaycheckDeposit['kind'],
  value = 0,
): PaycheckDeposit => ({ id, account: id, kind, value });

describe('computePaycheck', () => {
  it('computes net pay, percent and remainder deposits', () => {
    const totals = computePaycheck({
      grossAmount: 300000,
      deductions,
      deposits: [
        deposit('savings', 'percent', 10),
        deposit('checking', 'remainder'),
      ],
    });
    expect(totals.netAmount).toBe(225000);
    expect(totals.depositAmounts.get('savings')).toBe(22500);
    expect(totals.depositAmounts.get('checking')).toBe(202500);
    expect(totals.errors).toEqual([]);
  });

  it('gives rounding to the remainder', () => {
    const totals = computePaycheck({
      grossAmount: 100001,
      deductions: [],
      deposits: [
        deposit('savings', 'percent', 33),
        deposit('checking', 'remainder'),
      ],
    });
    expect(totals.depositAmounts.get('savings')).toBe(33000);
    expect(totals.depositAmounts.get('checking')).toBe(67001);
  });

  it.each([
    [
      [50, 50],
      [5001, 5000],
    ],
    [
      [33.33, 33.33, 33.34],
      [3333, 3333, 3335],
    ],
  ])(
    'gives an odd cent to the last of percents %j totalling 100',
    (percents, expected) => {
      const totals = computePaycheck({
        grossAmount: 10001,
        deductions: [],
        deposits: percents.map((p, i) => deposit(`d${i}`, 'percent', p)),
      });
      expect(
        percents.map((_, i) => totals.depositAmounts.get(`d${i}`)),
      ).toEqual(expected);
      expect(totals.errors).toEqual([]);
    },
  );

  it.each([
    ['deposits-do-not-add-up', [50, 40]],
    ['percents-exceed-100', [60, 50]],
  ] as const)(
    'reports %s for percents %j without a remainder',
    (error, percents) => {
      expect(
        computePaycheck({
          grossAmount: 10001,
          deductions: [],
          deposits: percents.map((p, i) => deposit(`d${i}`, 'percent', p)),
        }).errors,
      ).toContain(error);
    },
  );

  it.each([
    [
      'deductions-exceed-gross',
      { grossAmount: 1000, deposits: [deposit('checking', 'remainder')] },
    ],
    [
      'deposits-exceed-net',
      { grossAmount: 300000, deposits: [deposit('checking', 'fixed', 300000)] },
    ],
    [
      'percents-exceed-100',
      {
        grossAmount: 300000,
        deposits: [
          deposit('a', 'percent', 60),
          deposit('b', 'percent', 50),
          deposit('c', 'remainder'),
        ],
      },
    ],
    [
      'multiple-remainders',
      {
        grossAmount: 300000,
        deposits: [deposit('a', 'remainder'), deposit('b', 'remainder')],
      },
    ],
    [
      'deposits-do-not-add-up',
      { grossAmount: 300000, deposits: [deposit('checking', 'fixed', 200000)] },
    ],
    ['no-deposits', { grossAmount: 300000, deposits: [] }],
  ] as const)('reports %s', (error, { grossAmount, deposits }) => {
    expect(
      computePaycheck({ grossAmount, deductions, deposits: [...deposits] })
        .errors,
    ).toContain(error);
  });
});
