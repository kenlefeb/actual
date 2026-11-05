import { parse as csv2json } from 'csv-parse/sync';

import { amountToInteger, looselyParseAmount } from '#shared/util';

import type { AmazonCharge, AmazonItem } from './types';

// The source adapter (design decision 1): the only place that knows the
// export's column names and payment-method words.
// shortcut: provisional column names until sc-926 task 1.1 confirms the real header
const COLUMNS = {
  orderId: { label: 'order id', column: 'Order ID' },
  shipDate: { label: 'ship date', column: 'Ship Date' },
  itemName: { label: 'item name', column: 'Product Name' },
  quantity: { label: 'quantity', column: 'Quantity' },
  // Per unit
  itemPrice: { label: 'item price', column: 'Unit Price' },
  // For the row
  tax: { label: 'tax', column: 'Unit Price Tax' },
  shipping: { label: 'shipping', column: 'Shipping Charge' },
  discount: { label: 'discounts', column: 'Total Discounts' },
  paymentMethod: { label: 'payment method', column: 'Payment Instrument Type' },
} as const;
// Optional; null when the export has no per-shipment total
const SHIPMENT_TOTAL_COLUMN: string | null = null;
const GIFT_CARD_OR_POINTS_WORDS = ['gift', 'points', 'reward'];

type Row = Record<string, string>;

function cents(value: string | undefined): number {
  const amount = looselyParseAmount(value ?? '');
  return amount === null ? 0 : amountToInteger(Math.abs(amount));
}

function toDate(value: string | undefined): string | null {
  const iso = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  const us = value?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) {
    return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  }
  return null;
}

/**
 * Rebuilds the card charges from an order export: one charge per order and
 * ship date, in integer cents. Rows without a ship date are left out. A file
 * without the needed columns returns the missing fields instead.
 */
export function parseAmazonOrders(
  text: string,
): { charges: AmazonCharge[] } | { missing: string[] } {
  const rows: Row[] = csv2json(text, {
    columns: true,
    bom: true,
    trim: true,
    relax_column_count: true,
    skip_empty_lines: true,
  });
  const header = new Set(
    rows.length > 0
      ? Object.keys(rows[0])
      : (csv2json(text, { bom: true, to: 1 })[0] ?? []),
  );
  const missing = Object.values(COLUMNS)
    .filter(field => !header.has(field.column))
    .map(field => field.label);
  if (missing.length > 0) {
    return { missing };
  }

  const paidOtherwise = new Set<string>();
  for (const row of rows) {
    const method = (row[COLUMNS.paymentMethod.column] ?? '').toLowerCase();
    if (GIFT_CARD_OR_POINTS_WORDS.some(word => method.includes(word))) {
      paidOtherwise.add(row[COLUMNS.orderId.column]);
    }
  }

  const charges = new Map<string, AmazonCharge & { exportTotal: number }>();
  for (const row of rows) {
    const orderId = row[COLUMNS.orderId.column];
    const shipDate = toDate(row[COLUMNS.shipDate.column]);
    if (!orderId || !shipDate) {
      continue;
    }
    const item: AmazonItem = {
      name: row[COLUMNS.itemName.column],
      quantity: Number(row[COLUMNS.quantity.column]) || 1,
      price: cents(row[COLUMNS.itemPrice.column]),
      tax: cents(row[COLUMNS.tax.column]),
      shipping: cents(row[COLUMNS.shipping.column]),
      discount: cents(row[COLUMNS.discount.column]),
    };
    const id = `${orderId}|${shipDate}`;
    const charge = charges.get(id) ?? {
      id,
      orderId,
      shipDate,
      amount: 0,
      items: [],
      giftCardOrPoints: paidOtherwise.has(orderId),
      totalDifference: 0,
      exportTotal: 0,
    };
    charge.items.push(item);
    charge.amount +=
      item.price * item.quantity + item.tax + item.shipping - item.discount;
    if (SHIPMENT_TOTAL_COLUMN) {
      charge.exportTotal = cents(row[SHIPMENT_TOTAL_COLUMN]);
    }
    charges.set(id, charge);
  }

  return {
    charges: [...charges.values()].map(({ exportTotal, ...charge }) =>
      // The export's own total wins when it has one (design decision 2)
      exportTotal && exportTotal !== charge.amount
        ? {
            ...charge,
            amount: exportTotal,
            totalDifference: exportTotal - charge.amount,
          }
        : charge,
    ),
  };
}
