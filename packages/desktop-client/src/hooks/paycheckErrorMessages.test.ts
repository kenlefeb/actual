// Fork-only (sc-4343). The native editor maps loot-core's draft error codes
// to English from src/data/paycheck-error-messages.json (the Swift tests
// read it too). This pins that table to the web form's own messages.
import { createInstance } from 'i18next';

import messages from '#data/paycheck-error-messages.json';

import { paycheckErrorMessage } from './usePaycheckForm';

describe('paycheck error messages for native', () => {
  it('match the web form for every code', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'en', resources: {} });
    const t = (key: string, options?: Record<string, unknown>) =>
      i18n.t(key, options);

    for (const [code, message] of Object.entries(messages)) {
      expect(
        paycheckErrorMessage(
          code as Parameters<typeof paycheckErrorMessage>[0],
          t,
        ),
      ).toBe(message);
    }
    expect(Object.keys(messages).sort()).toEqual(
      [
        'name-missing',
        'clearing-name-missing',
        'clearing-account-missing',
        'clearing-account-not-open-on-budget',
        'duplicate-deposit-account',
        'transfer-account-missing',
        'deposit-account-missing',
        'deposit-to-clearing-account',
        'days-early-invalid',
        'deductions-exceed-gross',
        'deposits-exceed-net',
        'percents-exceed-100',
        'multiple-remainders',
        'deposits-do-not-add-up',
        'no-deposits',
      ].sort(),
    );
  });
});
