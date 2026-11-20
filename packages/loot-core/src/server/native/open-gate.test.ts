// Fork-only (sc-5463). A native read made while the page's own reopen is still
// opening the budget waits for it, instead of hitting a null database handle.
import { createApp } from '#server/app';

import {
  gateNativeHandlers,
  markBudgetClosed,
  markBudgetOpen,
} from './open-gate';

function makeApp() {
  const app = createApp<Record<string, (args?: unknown) => Promise<unknown>>>();
  const read = vi.fn(async () => 'month');
  const storage = vi.fn(async () => 'state');
  app.method('native/budget-month', read);
  app.method('native/storage-state', storage);
  return { app: gateNativeHandlers(app, 50), read, storage };
}

beforeEach(() => markBudgetClosed());

describe('native reads before the budget is open', () => {
  it('waits for the open to finish, then runs the read', async () => {
    const { app, read } = makeApp();
    const result = app.handlers['native/budget-month']({ month: '2026-03' });
    await new Promise(r => setTimeout(r, 10));
    expect(read).not.toHaveBeenCalled(); // a slow open: nothing read yet

    markBudgetOpen();

    await expect(result).resolves.toBe('month');
    expect(read).toHaveBeenCalledWith({ month: '2026-03' });
  });

  it('answers "not open yet" when the open never finishes', async () => {
    const { app, read } = makeApp();
    await expect(app.handlers['native/budget-month']()).rejects.toThrow(
      'budget-not-open',
    );
    expect(read).not.toHaveBeenCalled();
  });

  it('runs at once when the budget is already open', async () => {
    const { app } = makeApp();
    markBudgetOpen();
    await expect(app.handlers['native/budget-month']()).resolves.toBe('month');
  });

  it('waits again after the budget closes', async () => {
    const { app } = makeApp();
    markBudgetOpen();
    markBudgetClosed();
    await expect(app.handlers['native/budget-month']()).rejects.toThrow(
      'budget-not-open',
    );
  });

  it('never gates the storage handlers, which run before any budget opens', async () => {
    const { app, storage } = makeApp();
    await expect(app.handlers['native/storage-state']()).resolves.toBe('state');
    expect(storage).toHaveBeenCalled();
  });
});
