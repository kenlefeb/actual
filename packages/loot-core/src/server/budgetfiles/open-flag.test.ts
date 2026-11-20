// Fork-only (sc-5463). A load marks the budget open as soon as it can serve
// reads, before the upload step, which is a network call: a slow or failing
// upload must not hold native reads or make them fail.
// @ts-strict-ignore
import * as connection from '#platform/server/connection';
import * as fs from '#platform/server/fs';
import * as cloudStorage from '#server/cloud-storage';
import { handlers } from '#server/main';
import {
  disableGlobalMutations,
  enableGlobalMutations,
  runHandler,
} from '#server/mutators';
import { isBudgetOpen } from '#server/native/open-gate';

vi.mock('#server/post');
// A load outside NODE_ENV=test would start the backup timer
vi.mock('./backups', async importOriginal => ({
  ...(await importOriginal<object>()),
  startBackupService: vi.fn(),
  stopBackupService: vi.fn(),
}));

const budgetPath = fs.join(__dirname, '/../../mocks/files/budgets/test-budget');

beforeEach(async () => {
  await global.emptyDatabase()();
  disableGlobalMutations();
  const templatePath = fs.join(
    __dirname,
    '/../../mocks/files',
    'default-budget-template',
  );
  fs._setDocumentDir(fs.join(budgetPath, '..'));
  await fs.mkdir(budgetPath);
  for (const file of ['metadata.json', 'db.sqlite']) {
    await fs.copyFile(fs.join(templatePath, file), fs.join(budgetPath, file));
  }
  // The upload step only runs outside tests
  vi.stubEnv('NODE_ENV', 'development');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await runHandler(handlers['close-budget']);
  connection.resetEvents();
  enableGlobalMutations();
  fs._setDocumentDir(null);
  if (await fs.exists(budgetPath)) await fs.removeDirRecursively(budgetPath);
  vi.restoreAllMocks();
});

describe('the open flag during a load', () => {
  it('is set before the upload step runs', async () => {
    let openAtUpload: boolean | undefined;
    vi.spyOn(cloudStorage, 'possiblyUpload').mockImplementation(async () => {
      openAtUpload = isBudgetOpen();
    });

    const { error } = await runHandler(handlers['load-budget'], {
      id: 'test-budget',
    });

    expect(error).toBe(undefined);
    expect(openAtUpload).toBe(true);
  });

  it('is not held by a slow upload', async () => {
    let finish: (() => void) | undefined;
    let openWhileUploading: boolean | undefined;
    vi.spyOn(cloudStorage, 'possiblyUpload').mockImplementation(
      () =>
        new Promise<void>(resolve => {
          openWhileUploading = isBudgetOpen();
          finish = resolve;
        }),
    );

    const loading = runHandler(handlers['load-budget'], { id: 'test-budget' });
    await vi.waitFor(() => expect(finish).toBeDefined());
    expect(openWhileUploading).toBe(true);
    finish?.();
    await loading;
  });

  it('stays set when the upload fails', async () => {
    vi.spyOn(cloudStorage, 'possiblyUpload').mockRejectedValue(
      new Error('offline'),
    );

    await runHandler(handlers['load-budget'], { id: 'test-budget' }).catch(
      () => 'failed',
    );

    expect(isBudgetOpen()).toBe(true);
  });
});
