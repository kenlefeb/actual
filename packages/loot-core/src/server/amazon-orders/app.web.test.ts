import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

import { patchFetchForSqlJS } from '#mocks/util';
import { exists, init, writeFile } from '#platform/server/fs';
import * as idb from '#platform/server/indexeddb';
import * as sqlite from '#platform/server/sqlite';

import { app } from './app';

// Runs with the web platform (vitest.web.config.ts), where an uploaded file
// is copied into the worker's in-memory /uploads.
beforeAll(() => {
  const baseURL = `${__dirname}/../../../../../node_modules/@jlongster/sql.js/dist/`;
  patchFetchForSqlJS(baseURL);
  process.env.PUBLIC_URL = baseURL;
});

beforeEach(async () => {
  global.indexedDB = new IDBFactory();
  await idb.openDatabase();
  await sqlite.init();
  await init();
});

afterEach(() => {
  sqlite._getModule().reset_filesystem();
});

const HEADER =
  '"Order ID","Ship Date","Product Name","Quantity","Unit Price","Unit Price Tax","Shipping Charge","Total Discounts","Payment Instrument Type"\n';

describe('amazon-orders-parse on the web', () => {
  test('deletes its /uploads copy after reading an export', async () => {
    await writeFile('/uploads/orders.csv', HEADER);

    const result = await app.handlers['amazon-orders-parse']({
      filepath: '/uploads/orders.csv',
    });

    expect(result).toEqual({ reviews: [] });
    expect(await exists('/uploads/orders.csv')).toBe(false);
  });

  test('deletes its /uploads copy when the file is not an order export', async () => {
    await writeFile('/uploads/bank.csv', 'Date,Amount\n2026-11-04,-1.00\n');

    const result = await app.handlers['amazon-orders-parse']({
      filepath: '/uploads/bank.csv',
    });

    expect(result).toHaveProperty('error.missing');
    expect(await exists('/uploads/bank.csv')).toBe(false);
  });
});
