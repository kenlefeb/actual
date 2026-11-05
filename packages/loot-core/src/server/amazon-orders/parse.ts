import { parse as csv2json } from 'csv-parse/sync';

import { amountToInteger, looselyParseAmount } from '#shared/util';

import type { AmazonCharge, AmazonItem } from './types';

type Column = { label: string; column: string };
// A money column holds the amount for one unit or for the whole row
type MoneyColumn = Column & { per: 'unit' | 'row' };

export type ExportAdapter = {
  columns: {
    orderId: Column;
    shipDate: Column;
    itemName: Column;
    quantity: Column;
    itemPrice: MoneyColumn;
    tax: MoneyColumn;
    shipping: MoneyColumn;
    discount: MoneyColumn;
    paymentMethod: Column;
  };
  // Optional. 'shipment': each row repeats the shipment's total.
  // 'row': each row holds its own share, summed over the shipment.
  shipmentTotal: { column: string; per: 'shipment' | 'row' } | null;
  giftCardOrPointsWords: string[];
};

// The source adapter (design decision 1): the only place that knows the
// export's column names, what each money column covers and the
// payment-method words. Task 1.1 should only need to edit this table.
// shortcut: provisional column names until sc-926 task 1.1 confirms the real header
export const AMAZON_EXPORT: ExportAdapter = {
  columns: {
    orderId: { label: 'order id', column: 'Order ID' },
    shipDate: { label: 'ship date', column: 'Ship Date' },
    itemName: { label: 'item name', column: 'Product Name' },
    quantity: { label: 'quantity', column: 'Quantity' },
    itemPrice: { label: 'item price', column: 'Unit Price', per: 'unit' },
    tax: { label: 'tax', column: 'Unit Price Tax', per: 'row' },
    shipping: { label: 'shipping', column: 'Shipping Charge', per: 'row' },
    discount: { label: 'discounts', column: 'Total Discounts', per: 'row' },
    paymentMethod: {
      label: 'payment method',
      column: 'Payment Instrument Type',
    },
  },
  shipmentTotal: null,
  giftCardOrPointsWords: ['gift', 'points', 'reward'],
};

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

function readRows(text: string): { rows: Row[]; header: Set<string> } | null {
  try {
    const rows: Row[] = csv2json(text, {
      columns: true,
      bom: true,
      trim: true,
      relax_column_count: true,
      skip_empty_lines: true,
    });
    const header: string[] =
      rows.length > 0
        ? Object.keys(rows[0])
        : (csv2json(text, { bom: true, to: 1 })[0] ?? []);
    return { rows, header: new Set(header) };
  } catch {
    return null;
  }
}

/**
 * Rebuilds the card charges from an order export: one charge per order and
 * ship date, in integer cents. Rows without a ship date are left out. A file
 * without the needed columns, or that isn't readable CSV, returns the missing
 * fields instead.
 */
export function parseAmazonOrders(
  text: string,
  {
    columns,
    shipmentTotal,
    giftCardOrPointsWords,
  }: ExportAdapter = AMAZON_EXPORT,
): { charges: AmazonCharge[] } | { missing: string[] } {
  const read = readRows(text);
  const missing = Object.values(columns)
    .filter(field => !read?.header.has(field.column))
    .map(field => field.label);
  if (!read || missing.length > 0) {
    return { missing };
  }

  const paidOtherwise = new Set<string>();
  for (const row of read.rows) {
    const method = (row[columns.paymentMethod.column] ?? '').toLowerCase();
    if (giftCardOrPointsWords.some(word => method.includes(word))) {
      paidOtherwise.add(row[columns.orderId.column]);
    }
  }

  const charges = new Map<string, AmazonCharge & { exportTotal: number }>();
  for (const row of read.rows) {
    const orderId = row[columns.orderId.column];
    const shipDate = toDate(row[columns.shipDate.column]);
    if (!orderId || !shipDate) {
      continue;
    }
    const quantity = Number(row[columns.quantity.column]) || 1;
    // Unit amounts for the price, row totals for the rest
    const money = (column: MoneyColumn, per: 'unit' | 'row') => {
      const value = cents(row[column.column]);
      if (column.per === per) {
        return value;
      }
      return per === 'row' ? value * quantity : Math.round(value / quantity);
    };
    const item: AmazonItem = {
      name: row[columns.itemName.column],
      quantity,
      price: money(columns.itemPrice, 'unit'),
      tax: money(columns.tax, 'row'),
      shipping: money(columns.shipping, 'row'),
      discount: money(columns.discount, 'row'),
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
    if (shipmentTotal) {
      const total = cents(row[shipmentTotal.column]);
      charge.exportTotal =
        shipmentTotal.per === 'shipment' ? total : charge.exportTotal + total;
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
