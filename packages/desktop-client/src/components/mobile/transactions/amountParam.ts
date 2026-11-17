import { amountToInteger } from '@actual-app/core/shared/util';

// Above this a value is not an amount a person meant (sc-4825, D2)
const MAX_PARAM = 1_000_000_000;

/**
 * The add form's `amount` URL parameter: a decimal the form negates (a
 * positive value is a payment). Not finite, or larger than MAX_PARAM, reads
 * as 0, so a link cannot fill in a hostile amount.
 */
export function amountFromParam(param: string | null): number {
  const value = parseFloat(param || '');
  if (!Number.isFinite(value) || Math.abs(value) > MAX_PARAM) return 0;
  return -amountToInteger(value) || 0;
}
