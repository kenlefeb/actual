import { readFileSync } from 'fs';
import { join } from 'path';

import { parseAmazonOrders } from './parse';
import type { AmazonCharge } from './types';

const fixture = readFileSync(
  join(__dirname, '__fixtures__', 'order-history.csv'),
  'utf8',
);

function charges(): AmazonCharge[] {
  const result = parseAmazonOrders(fixture);
  if ('missing' in result) {
    throw new Error(`missing ${result.missing.join(', ')}`);
  }
  return result.charges;
}

function forOrder(orderId: string) {
  return charges().filter(c => c.orderId === orderId);
}

describe('parseAmazonOrders', () => {
  test('Not an order export', () => {
    const bank = 'Date,Description,Amount\n2026-11-04,AMZN Mktp US,-32.40\n';

    expect(parseAmazonOrders(bank)).toEqual({
      missing: [
        'order id',
        'ship date',
        'item name',
        'quantity',
        'item price',
        'tax',
        'shipping',
        'discounts',
        'payment method',
      ],
    });
  });

  test('a missing field is named', () => {
    const [header, ...rows] = fixture.split('\n');
    const withoutTax = [header.replace('"Unit Price Tax"', '"Other"'), ...rows];

    expect(parseAmazonOrders(withoutTax.join('\n'))).toEqual({
      missing: ['tax'],
    });
  });

  test('Split shipment', () => {
    expect(
      forOrder('111-0000001').map(c => [c.shipDate, c.amount, c.items.length]),
    ).toEqual([
      ['2026-11-02', 1296, 1],
      ['2026-11-04', 3240, 1],
    ]);
  });

  test('a two-item charge adds price × quantity, tax, shipping and discounts', () => {
    const [lampAndBulbs] = forOrder('111-0000003');
    const [desk] = forOrder('111-0000007');

    expect(lampAndBulbs.amount).toBe(3240);
    expect(lampAndBulbs.items[1]).toEqual({
      name: 'Example Bulb pack',
      quantity: 2,
      price: 500,
      tax: 80,
      shipping: 0,
      discount: 0,
    });
    expect(desk.amount).toBe(6000);
  });

  test('Order paid partly by a gift card', () => {
    expect(forOrder('111-0000002').map(c => c.giftCardOrPoints)).toEqual([
      true,
    ]);
    expect(forOrder('111-0000001').map(c => c.giftCardOrPoints)).toEqual([
      false,
      false,
    ]);
  });

  test('rows without a ship date are left out', () => {
    expect(forOrder('111-0000008')).toEqual([]);
  });
});
