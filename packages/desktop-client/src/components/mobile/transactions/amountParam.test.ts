import { describe, expect, it } from 'vitest';

import { amountFromParam } from './amountParam';

// native-reconcile-resolve-and-lock D2 (sc-4825): the add form's `amount`
// parameter is a decimal the form negates; loot-core's add_amount_param
// passes the difference that way, and a hostile value reads as zero.
describe('amountFromParam', () => {
  it.each([
    ['-41.80', 4180],
    ['41.80', -4180],
    ['10', -1000],
    ['-0.05', 5],
  ])('%s gives a form amount of %i', (param, amount) => {
    expect(amountFromParam(param)).toBe(amount);
  });

  it.each([
    null,
    '',
    'abc',
    '1e999',
    'Infinity',
    'NaN',
    '2000000000',
    '-1000000001',
  ])('%j reads as zero', param => {
    expect(amountFromParam(param)).toBe(0);
  });
});
