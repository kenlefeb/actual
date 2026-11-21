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
import * as sheet from '#server/sheet';

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

// Fork-only (sc-5496): a native screen that read during a slow open re-reads
// on this event, so it is sent once per successful open and never otherwise.
describe('the budget-opened event', () => {
  function openedCount(send: ReturnType<typeof vi.spyOn>) {
    return send.mock.calls.filter(([name]) => name === 'budget-opened').length;
  }

  it('is sent with no payload once the budget is open, once per open', async () => {
    const send = vi.spyOn(connection, 'send');
    vi.spyOn(cloudStorage, 'possiblyUpload').mockResolvedValue(undefined);

    await runHandler(handlers['load-budget'], { id: 'test-budget' });
    expect(openedCount(send)).toBe(1);
    expect(send).toHaveBeenCalledWith('budget-opened');
    expect(send.mock.calls.find(([n]) => n === 'budget-opened')).toHaveLength(
      1,
    );

    await runHandler(handlers['close-budget']);
    await runHandler(handlers['load-budget'], { id: 'test-budget' });
    expect(openedCount(send)).toBe(2);
  });

  it('is sent after the budget is marked open', async () => {
    let openAtSend: boolean | undefined;
    vi.spyOn(connection, 'send').mockImplementation(name => {
      if (name === 'budget-opened') openAtSend = isBudgetOpen();
    });
    vi.spyOn(cloudStorage, 'possiblyUpload').mockResolvedValue(undefined);

    await runHandler(handlers['load-budget'], { id: 'test-budget' });

    expect(openAtSend).toBe(true);
  });

  it('is not sent when the open fails', async () => {
    const send = vi.spyOn(connection, 'send');
    vi.spyOn(sheet, 'loadSpreadsheet').mockRejectedValue(new Error('broken'));

    const { error } = await runHandler(handlers['load-budget'], {
      id: 'test-budget',
    });

    expect(error).toBe('opening-budget');
    expect(openedCount(send)).toBe(0);
  });
});

describe('the slow-open test hook', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as { __forkTestSlowOpen?: number }).__forkTestSlowOpen;
  });

  it('holds the open back by the build-time delay, then opens', async () => {
    vi.stubGlobal('__FORK_TEST_HOOKS__', true);
    vi.stubGlobal('__FORK_TEST_SLOW_OPEN_MS__', 300);
    vi.spyOn(cloudStorage, 'possiblyUpload').mockResolvedValue(undefined);

    const loading = runHandler(handlers['load-budget'], { id: 'test-budget' });
    await vi.waitFor(() =>
      expect(
        (globalThis as { __forkTestSlowOpen?: number }).__forkTestSlowOpen,
      ).toBe(300),
    );
    expect(isBudgetOpen()).toBe(false);

    await loading;
    expect(isBudgetOpen()).toBe(true);
  });

  it('does nothing at 0, or without the test-hooks constant', async () => {
    vi.stubGlobal('__FORK_TEST_HOOKS__', true);
    vi.stubGlobal('__FORK_TEST_SLOW_OPEN_MS__', 0);
    vi.spyOn(cloudStorage, 'possiblyUpload').mockResolvedValue(undefined);
    await runHandler(handlers['load-budget'], { id: 'test-budget' });
    expect(
      (globalThis as { __forkTestSlowOpen?: number }).__forkTestSlowOpen,
    ).toBeUndefined();

    await runHandler(handlers['close-budget']);
    vi.stubGlobal('__FORK_TEST_HOOKS__', false);
    vi.stubGlobal('__FORK_TEST_SLOW_OPEN_MS__', 300);
    await runHandler(handlers['load-budget'], { id: 'test-budget' });
    expect(
      (globalThis as { __forkTestSlowOpen?: number }).__forkTestSlowOpen,
    ).toBeUndefined();
  });
});
