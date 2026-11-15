// Fork-only (sc-4343). The paycheck editor's form rules, moved from the web's
// usePaycheckForm so the web and the native editor share one rule set.
import type { PaycheckDefinition } from '#types/models';

import { changedDepositDaysEarly, validatePaycheckDraft } from './paychecks';
import type { PaycheckDraft } from './paychecks';

const definition = (
  fields: Partial<PaycheckDefinition> = {},
): PaycheckDefinition => ({
  payee: 'acme',
  clearingAccount: 'clearing',
  date: { start: '2026-11-01', frequency: 'monthly', interval: 1 },
  weekendSolveMode: 'before',
  grossAmount: 300000,
  incomeCategory: null,
  deductions: [],
  deposits: [{ id: 'd1', account: 'checking', kind: 'remainder', value: 0 }],
  ...fields,
});

const draft = (fields: Partial<PaycheckDraft> = {}): PaycheckDraft => ({
  name: 'Acme',
  definition: definition(),
  isNewAccount: false,
  clearingName: '',
  clearing: { offbudget: false, closed: false },
  changedDaysEarly: [],
  ...fields,
});

describe('validatePaycheckDraft', () => {
  it('accepts a valid draft', () => {
    expect(validatePaycheckDraft(draft())).toEqual([]);
  });

  it.each([
    ['name-missing', 'name', draft({ name: '  ' })],
    [
      'clearing-name-missing',
      'clearingAccount',
      draft({ isNewAccount: true, clearingName: '' }),
    ],
    [
      'clearing-account-missing',
      'clearingAccount',
      draft({ definition: definition({ clearingAccount: '' }) }),
    ],
    [
      'clearing-account-not-open-on-budget',
      'clearingAccount',
      draft({ clearing: { offbudget: true, closed: false } }),
    ],
    [
      'clearing-account-not-open-on-budget',
      'clearingAccount',
      draft({ clearing: { offbudget: false, closed: true } }),
    ],
    [
      'duplicate-deposit-account',
      'deposits',
      draft({
        definition: definition({
          deposits: [
            { id: 'a', account: 'checking', kind: 'fixed', value: 1000 },
            { id: 'b', account: 'checking', kind: 'remainder', value: 0 },
          ],
        }),
      }),
    ],
    [
      'transfer-account-missing',
      'deductions',
      draft({
        definition: definition({
          deductions: [
            { id: 'k', name: '401k', amount: 1, transferAccount: '' },
          ],
        }),
      }),
    ],
    [
      'deposit-account-missing',
      'deposits',
      draft({
        definition: definition({
          deposits: [{ id: 'a', account: '', kind: 'remainder', value: 0 }],
        }),
      }),
    ],
    [
      'deposit-to-clearing-account',
      'deposits',
      draft({
        definition: definition({
          deposits: [
            { id: 'a', account: 'clearing', kind: 'remainder', value: 0 },
          ],
        }),
      }),
    ],
    [
      'days-early-invalid',
      'deposits',
      draft({ changedDaysEarly: [{ account: 'checking', days: null }] }),
    ],
    [
      'deductions-exceed-gross',
      'deductions',
      draft({
        definition: definition({
          grossAmount: 200000,
          deductions: [{ id: 't', name: 'Tax', amount: 210000 }],
        }),
      }),
    ],
    [
      'deposits-exceed-net',
      'deposits',
      draft({
        definition: definition({
          deposits: [
            { id: 'a', account: 'checking', kind: 'fixed', value: 400000 },
          ],
        }),
      }),
    ],
    [
      'percents-exceed-100',
      'deposits',
      draft({
        definition: definition({
          deposits: [
            { id: 'a', account: 'a', kind: 'percent', value: 60 },
            { id: 'b', account: 'b', kind: 'percent', value: 50 },
            { id: 'c', account: 'c', kind: 'remainder', value: 0 },
          ],
        }),
      }),
    ],
    [
      'multiple-remainders',
      'deposits',
      draft({
        definition: definition({
          deposits: [
            { id: 'a', account: 'a', kind: 'remainder', value: 0 },
            { id: 'b', account: 'b', kind: 'remainder', value: 0 },
          ],
        }),
      }),
    ],
    [
      'deposits-do-not-add-up',
      'deposits',
      draft({
        definition: definition({
          deposits: [{ id: 'a', account: 'a', kind: 'fixed', value: 1000 }],
        }),
      }),
    ],
    [
      'no-deposits',
      'deposits',
      draft({ definition: definition({ deposits: [] }) }),
    ],
  ])('reports %s on %s', (code, field, value) => {
    expect(validatePaycheckDraft(value)).toContainEqual({ code, field });
  });

  it('keeps the web order: form rules first, then the amounts', () => {
    const errors = validatePaycheckDraft(
      draft({ name: '', definition: definition({ deposits: [] }) }),
    );
    expect(errors.map(e => e.code)).toEqual(['name-missing', 'no-deposits']);
  });

  it('does not ask for an existing account while creating a new one', () => {
    expect(
      validatePaycheckDraft(
        draft({
          isNewAccount: true,
          clearingName: 'Acme Paycheck',
          definition: definition({ clearingAccount: '' }),
          clearing: undefined,
        }),
      ),
    ).toEqual([]);
  });
});

describe('changedDepositDaysEarly', () => {
  const saved = new Map([
    ['checking', 0],
    ['savings', 2],
  ]);
  const deposits = definition({
    deposits: [
      { id: 'a', account: 'checking', kind: 'fixed', value: 1 },
      { id: 'b', account: 'savings', kind: 'remainder', value: 0 },
    ],
  }).deposits;

  it('lists only changed, still-deposited, known accounts; null when invalid', () => {
    expect(
      changedDepositDaysEarly(
        deposits,
        { checking: '3', savings: '2', gone: '4' },
        saved,
      ),
    ).toEqual([{ account: 'checking', days: 3 }]);
    expect(
      changedDepositDaysEarly(deposits, { checking: '11', savings: '' }, saved),
    ).toEqual([
      { account: 'checking', days: null },
      { account: 'savings', days: null },
    ]);
    expect(
      changedDepositDaysEarly(deposits, { checking: '1.5' }, saved),
    ).toEqual([{ account: 'checking', days: null }]);
  });
});
