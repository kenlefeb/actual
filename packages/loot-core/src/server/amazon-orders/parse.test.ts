import { readFileSync } from 'fs';
import { join } from 'path';

import { AMAZON_EXPORT, parseAmazonOrders } from './parse';
import type { ExportAdapter } from './parse';
import type { AmazonCharge } from './types';

const fixture = readFileSync(
  join(__dirname, '__fixtures__', 'order-history.csv'),
  'utf8',
);

function charges(
  text = fixture,
  adapter: ExportAdapter = AMAZON_EXPORT,
): AmazonCharge[] {
  const result = parseAmazonOrders(text, adapter);
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

describe('the export adapter', () => {
  const ALL_FIELDS = Object.values(AMAZON_EXPORT.columns).map(c => c.label);

  test('a column read per unit is multiplied by the quantity', () => {
    const perUnitTax: ExportAdapter = {
      ...AMAZON_EXPORT,
      columns: {
        ...AMAZON_EXPORT.columns,
        tax: { ...AMAZON_EXPORT.columns.tax, per: 'unit' },
      },
    };

    const [lampAndBulbs] = charges(fixture, perUnitTax).filter(
      c => c.orderId === '111-0000003',
    );

    expect(lampAndBulbs.items[1].tax).toBe(160);
    expect(lampAndBulbs.amount).toBe(3320);
  });

  const header = fixture.split('\n')[0] + ',"Shipment Total"';
  const row = (name: string, price: string, total: string) =>
    `"111-0000020","2026-11-02","${name}","1","${price}","0","0","0","Visa - 0000","${total}"`;

  test('a shipment total repeated on each row wins over the item sum', () => {
    const text = [
      header,
      row('A', '10.00', '16.00'),
      row('B', '5.00', '16.00'),
    ];

    const [charge] = charges(text.join('\n'), {
      ...AMAZON_EXPORT,
      shipmentTotal: { column: 'Shipment Total', per: 'shipment' },
    });

    expect(charge.amount).toBe(1600);
    expect(charge.totalDifference).toBe(100);
  });

  test('a total given per row is summed over the shipment', () => {
    const text = [header, row('A', '10.00', '10.50'), row('B', '5.00', '5.50')];

    const [charge] = charges(text.join('\n'), {
      ...AMAZON_EXPORT,
      shipmentTotal: { column: 'Shipment Total', per: 'row' },
    });

    expect(charge.amount).toBe(1600);
    expect(charge.totalDifference).toBe(100);
  });

  test('a file that is not readable CSV is refused like any non-export', () => {
    expect(parseAmazonOrders('"Order ID,"Ship Date\n"broken')).toEqual({
      missing: ALL_FIELDS,
    });
  });
});
