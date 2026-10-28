import type { PaycheckDefinition, PaycheckDeposit } from '#types/models';

export type PaycheckError =
  | 'deductions-exceed-gross'
  | 'deposits-exceed-net'
  | 'percents-exceed-100'
  | 'multiple-remainders'
  | 'deposits-do-not-add-up'
  | 'no-deposits';

export type PaycheckTotals = {
  netAmount: number;
  // Deposit id -> amount in cents
  depositAmounts: Map<PaycheckDeposit['id'], number>;
  errors: PaycheckError[];
};

type PaycheckAmounts = Pick<
  PaycheckDefinition,
  'grossAmount' | 'deductions' | 'deposits'
>;

/**
 * Net pay and each deposit's amount, in cents. Percent deposits round half
 * away from zero and the remainder deposit takes what is left, so rounding
 * never leaves money in the clearing account.
 */
export function computePaycheck({
  grossAmount,
  deductions,
  deposits,
}: PaycheckAmounts): PaycheckTotals {
  const errors: PaycheckError[] = [];
  const deducted = deductions.reduce((sum, d) => sum + d.amount, 0);
  const netAmount = grossAmount - deducted;
  if (netAmount < 0) {
    errors.push('deductions-exceed-gross');
  }

  const depositAmounts = new Map<PaycheckDeposit['id'], number>();
  let assigned = 0;
  let percentTotal = 0;
  for (const deposit of deposits) {
    if (deposit.kind === 'remainder') {
      continue;
    }
    const amount =
      deposit.kind === 'fixed'
        ? deposit.value
        : Math.round((netAmount * deposit.value) / 100);
    if (deposit.kind === 'percent') {
      percentTotal += deposit.value;
    }
    depositAmounts.set(deposit.id, amount);
    assigned += amount;
  }

  const remainders = deposits.filter(d => d.kind === 'remainder');
  for (const deposit of remainders) {
    depositAmounts.set(deposit.id, netAmount - assigned);
  }

  if (deposits.length === 0) {
    errors.push('no-deposits');
  }
  if (percentTotal > 100) {
    errors.push('percents-exceed-100');
  }
  if (remainders.length > 1) {
    errors.push('multiple-remainders');
  }
  if (assigned > netAmount) {
    errors.push('deposits-exceed-net');
  } else if (
    deposits.length > 0 &&
    remainders.length === 0 &&
    assigned !== netAmount
  ) {
    errors.push('deposits-do-not-add-up');
  }
  return { netAmount, depositAmounts, errors };
}
