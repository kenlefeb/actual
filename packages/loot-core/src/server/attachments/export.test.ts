import * as nativeFs from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as fs from '#platform/server/fs';
import * as sqlite from '#platform/server/sqlite';
import { exportBuffer } from '#server/cloud-storage';
import * as prefs from '#server/prefs';
import { safeUnzip } from '#server/util/zip';

// Pins existing behavior: the export already zips only these two files
describe('Export a budget with attachments', () => {
  it('holds no document content', async () => {
    const documentDir = nativeFs.mkdtempSync(
      path.join(os.tmpdir(), 'actual-export-'),
    );
    onTestFinished(() =>
      nativeFs.rmSync(documentDir, { recursive: true, force: true }),
    );
    fs._setDocumentDir(documentDir);
    vi.stubEnv('ACTUAL_DATA_DIR', documentDir);
    // Zip entries need a real date; tests fake one in 1970
    const now = vi
      .spyOn(Date, 'now')
      .mockReturnValue(Date.parse('2026-11-05T12:00:00Z'));
    onTestFinished(() => now.mockRestore());
    await prefs.loadPrefs();
    const budgetDir = fs.getBudgetDir('test');
    nativeFs.mkdirSync(path.join(budgetDir, 'attachments'), {
      recursive: true,
    });

    await sqlite.init();
    const db = await sqlite.openDatabase(path.join(budgetDir, 'db.sqlite'));
    // Only what the export touches
    sqlite.execQuery(
      db,
      'CREATE TABLE kvcache (key TEXT, value TEXT); CREATE TABLE kvcache_key (id INTEGER, key REAL);',
    );
    sqlite.closeDatabase(db);
    nativeFs.writeFileSync(path.join(budgetDir, 'metadata.json'), '{}');
    // A document opened on this device sits in the budget folder
    nativeFs.writeFileSync(
      path.join(budgetDir, 'attachments', 'att-1.blob'),
      '%PDF-1.7 receipt',
    );

    const exported = await exportBuffer();

    expect(
      Object.keys(safeUnzip(exported?.data ?? new Uint8Array())).sort(),
    ).toEqual(['db.sqlite', 'metadata.json']);
  });
});
