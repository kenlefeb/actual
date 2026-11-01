import { z } from 'zod';

/** Registers one read tool; `tools.ts` wraps it with data labelling and error hygiene. */
export type RegisterTool = <S extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: S,
  fn: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>,
) => void;

export const pageShape = {
  limit: z.number().int().optional(),
  cursor: z.string().optional(),
};

export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

/** Integer minor units plus a decimal string, so the model never does cent math. */
export function money(amount: number) {
  const abs = Math.abs(amount);
  const decimal = `${amount < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return { amount, amount_decimal: decimal };
}

/** A refusal whose message (fixed text, never budget data) the model may see. */
export class Refusal extends Error {}

/** `money` for a named field: `gross` becomes `gross` and `gross_decimal`. */
export function moneyAs(name: string, amount: number) {
  const m = money(amount);
  return { [name]: m.amount, [`${name}_decimal`]: m.amount_decimal };
}
