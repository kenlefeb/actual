// Fork-only (sc-5463). Every way a budget gets opened marks it open, so a
// native read made afterwards runs at once instead of waiting out the gate
// and answering "budget-not-open".
// @ts-strict-ignore
import * as connection from '#platform/server/connection';
import * as fs from '#platform/server/fs';
import { handlers } from '#server/main';
import {
  disableGlobalMutations,
  enableGlobalMutations,
  runHandler,
} from '#server/mutators';
import { isBudgetOpen } from '#server/native/open-gate';
import * as prefs from '#server/prefs';

vi.mock('#server/post');

const docDir = fs.join(__dirname, '/../../mocks/files/open-paths');

beforeEach(async () => {
  await global.emptyDatabase()();
  disableGlobalMutations();
  if (await fs.exists(docDir)) await fs.removeDirRecursively(docDir);
  await fs.mkdir(docDir);
  fs._setDocumentDir(docDir);
});

afterEach(async () => {
  await runHandler(handlers['close-budget']);
  connection.resetEvents();
  enableGlobalMutations();
  fs._setDocumentDir(null);
  if (await fs.exists(docDir)) await fs.removeDirRecursively(docDir);
});

// Gated like the page's own call; waits only if the budget were not marked
const nativeRead = () =>
  runHandler(handlers['native/accounts-list'] as () => Promise<unknown>);

describe('paths that open a budget', () => {
  it('a new budget', async () => {
    expect(isBudgetOpen()).toBe(false);
    await runHandler(handlers['create-budget'], {
      budgetName: 'One',
      avoidUpload: true,
    });
    expect(isBudgetOpen()).toBe(true);
    await expect(nativeRead()).resolves.toBeDefined();
  });

  it('the demo budget', async () => {
    await runHandler(handlers['create-demo-budget']);
    expect(isBudgetOpen()).toBe(true);
    await expect(nativeRead()).resolves.toBeDefined();
  });

  it('closing, then reopening, then switching to another budget', async () => {
    await runHandler(handlers['create-budget'], {
      budgetName: 'One',
      avoidUpload: true,
    });
    const one = prefs.getPrefs().id;
    await runHandler(handlers['close-budget']);
    expect(isBudgetOpen()).toBe(false);
    await expect(nativeRead()).rejects.toThrow('budget-not-open');

    await runHandler(handlers['load-budget'], { id: one });
    expect(isBudgetOpen()).toBe(true);

    await runHandler(handlers['create-budget'], {
      budgetName: 'Two',
      avoidUpload: true,
    });
    await runHandler(handlers['load-budget'], { id: one });
    expect(isBudgetOpen()).toBe(true);
    await expect(nativeRead()).resolves.toBeDefined();
  });
});
