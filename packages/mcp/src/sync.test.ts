import * as api from '@actual-app/api';

import { buildFixtureBudget } from './fixture';
import { createServer } from './server';
import {
  registerSyncStatusTool,
  resetSyncState,
  startSyncSchedule,
  syncNow,
  syncStatus,
} from './sync';

let fixture: Awaited<ReturnType<typeof buildFixtureBudget>>;

beforeEach(() => resetSyncState());
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await fixture?.cleanup();
});

describe('the copy stays fresh', () => {
  it('A failed sync', async () => {
    fixture = await buildFixtureBudget({ count: 2 });
    const sync = vi.spyOn(api, 'sync').mockResolvedValueOnce(undefined);
    await syncNow();
    const good = syncStatus().last_success;
    expect(good).toEqual(expect.any(String));

    sync.mockRejectedValue(new Error('sync server unreachable'));
    await expect(syncNow()).rejects.toThrow();

    // The tools still answer from the last copy, and the status says so.
    const [clientT, serverT] = (
      await import('@modelcontextprotocol/sdk/inMemory.js')
    ).InMemoryTransport.createLinkedPair();
    const { Client } =
      await import('@modelcontextprotocol/sdk/client/index.js');
    const server = createServer([], { registerExtra: registerSyncStatusTool });
    await server.connect(serverT);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(clientT);
    const text = (field: unknown) =>
      JSON.parse((field as Array<{ text: string }>)[0].text);
    const accounts = text(
      (await client.callTool({ name: 'list_accounts', arguments: {} })).content,
    );
    expect(
      accounts.items.map((a: { text: { name: string } }) => a.text.name),
    ).toEqual(['Checking']);
    const status = text(
      (await client.callTool({ name: 'get_sync_status', arguments: {} }))
        .content,
    );
    expect(status).toMatchObject({
      last_success: good,
      last_attempt_failed: true,
    });
    await client.close();
  });

  it('Syncs are serialized', async () => {
    fixture = await buildFixtureBudget({ count: 1 });
    let running = 0;
    let overlapped = false;
    vi.spyOn(api, 'sync').mockImplementation(async () => {
      running++;
      if (running > 1) overlapped = true;
      await new Promise(resolve => setTimeout(resolve, 20));
      running--;
    });
    await Promise.all([syncNow(), syncNow(), syncNow()]);
    expect(overlapped).toBe(false);
    expect(api.sync).toHaveBeenCalledTimes(3);
  });

  it('A sync on an interval', async () => {
    fixture = await buildFixtureBudget({ count: 1 });
    const sync = vi.spyOn(api, 'sync').mockResolvedValue(undefined);
    vi.useFakeTimers();
    const stop = startSyncSchedule(1000);
    await vi.advanceTimersByTimeAsync(3500);
    stop();
    expect(sync).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(5000);
    expect(sync).toHaveBeenCalledTimes(3);
  });

  it('A failing interval sync does not stop the schedule', async () => {
    fixture = await buildFixtureBudget({ count: 1 });
    const sync = vi
      .spyOn(api, 'sync')
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue(undefined);
    vi.useFakeTimers();
    const stop = startSyncSchedule(1000);
    await vi.advanceTimersByTimeAsync(2500);
    stop();
    expect(sync).toHaveBeenCalledTimes(2);
    expect(syncStatus().last_attempt_failed).toBe(false);
  });
});
