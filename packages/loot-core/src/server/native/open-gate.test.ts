// Fork-only (sc-5463). A native read made while the page's own reopen is still
// opening the budget waits for it, instead of hitting a null database handle.
import { createApp } from '#server/app';

import {
  gateNativeHandlers,
  markBudgetClosed,
  markBudgetOpen,
  ungated,
  whileOpening,
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
    let finishOpen: (() => void) | undefined;
    const opening = whileOpening(
      () =>
        new Promise<void>(resolve => {
          finishOpen = () => {
            markBudgetOpen();
            resolve();
          };
        }),
    );
    const result = app.handlers['native/budget-month']({ month: '2026-03' });
    await new Promise(r => setTimeout(r, 10));
    expect(read).not.toHaveBeenCalled(); // a slow open: nothing read yet

    finishOpen?.();
    await opening;

    await expect(result).resolves.toBe('month');
    expect(read).toHaveBeenCalledWith({ month: '2026-03' });
  });

  it('answers "not open yet" when the open outlasts the wait', async () => {
    const { app, read } = makeApp();
    let finishOpen: (() => void) | undefined;
    const opening = whileOpening(
      () => new Promise<void>(resolve => (finishOpen = resolve)),
    );
    await expect(app.handlers['native/budget-month']()).rejects.toThrow(
      'budget-not-open',
    );
    expect(read).not.toHaveBeenCalled();
    finishOpen?.();
    await opening;
  });

  it('runs at once when the budget is already open', async () => {
    const { app } = makeApp();
    markBudgetOpen();
    await expect(app.handlers['native/budget-month']()).resolves.toBe('month');
  });

  it('answers at once when no budget is open and none is opening', async () => {
    const { app, read } = makeApp();
    const started = Date.now();
    await expect(app.handlers['native/budget-month']()).rejects.toThrow(
      'budget-not-open',
    );
    expect(Date.now() - started).toBeLessThan(40); // the wait is 50 ms
    expect(read).not.toHaveBeenCalled();
  });

  it('answers at once when the open fails, without waiting out the bound', async () => {
    const { app } = makeApp();
    let failOpen: (() => void) | undefined;
    const opening = whileOpening(
      () =>
        new Promise<void>((_, reject) => {
          failOpen = () => reject(new Error('opening-budget'));
        }),
    ).catch(() => 'failed');
    const result = app.handlers['native/budget-month']().catch(e => e.message);
    const started = Date.now();
    failOpen?.();
    expect(await opening).toBe('failed');
    expect(await result).toBe('budget-not-open');
    expect(Date.now() - started).toBeLessThan(40);
  });

  it('answers at once after the budget closes on purpose', async () => {
    const { app } = makeApp();
    markBudgetOpen();
    markBudgetClosed();
    const started = Date.now();
    await expect(app.handlers['native/budget-month']()).rejects.toThrow(
      'budget-not-open',
    );
    expect(Date.now() - started).toBeLessThan(40);
  });

  it('never gates the storage handlers, which run before any budget opens', async () => {
    const { app, storage } = makeApp();
    await expect(app.handlers['native/storage-state']()).resolves.toBe('state');
    expect(storage).toHaveBeenCalled();
  });

  it('leaves a handler ungated once a test-hooks build registers it', async () => {
    const app = createApp<Record<string, () => Promise<unknown>>>();
    app.method('native/hook-only', async () => 'armed');
    ungated('native/hook-only');
    await expect(
      gateNativeHandlers(app, 50).handlers['native/hook-only'](),
    ).resolves.toBe('armed');
  });
});
