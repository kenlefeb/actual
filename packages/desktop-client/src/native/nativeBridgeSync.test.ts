import allowlist from '#data/native-bridge-allowlist.json';

import { createNativeBridge } from './nativeBridge';

// native-bridge: "Sync is allowlisted as a call with no arguments", "The page
// returns only whether the sync worked and why not" and "A sync error reveals
// nothing about the server" (sc-3884)
const SERVER = 'https://sync.example.com/sync/sync';

function setup(reply: () => Promise<unknown>) {
  const send = vi.fn((_name: string, _args?: unknown) => reply());
  const bridge = createNativeBridge({
    send,
    listen: vi.fn(() => vi.fn()),
    notify: vi.fn(),
  });
  return { bridge, send };
}

function failure(reason: string) {
  return async () => ({
    error: { message: `${SERVER} said no`, reason, meta: { body: SERVER } },
  });
}

async function syncResult(reply: () => Promise<unknown>) {
  return JSON.parse(await setup(reply).bridge.call('sync', {}));
}

describe('sync', () => {
  it('is on the page allowlist', () => {
    expect(allowlist).toContain('sync');
  });

  it('returns ok and no messages when loot-core returns messages', async () => {
    expect(
      await syncResult(async () => ({ messages: [{ dataset: 'x' }] })),
    ).toEqual({ ok: true });
  });

  it.each([
    ['network-failure', 'network'],
    ['unauthorized', 'unauthorized'],
    ['out-of-sync', 'out-of-sync'],
    ['clock-drift', 'clock-drift'],
    ['encrypt-failure', 'encryption'],
    ['decrypt-failure', 'encryption'],
    ['invalid-schema', 'other'],
    ['something-new', 'other'],
    ['constructor', 'other'],
  ])('maps the loot-core reason %s to %s', async (lootCore, reason) => {
    expect(await syncResult(failure(lootCore))).toEqual({ ok: false, reason });
  });

  it('drops the message and meta that hold the server address', async () => {
    const json = await setup(failure('network-failure')).bridge.call('sync');
    expect(json).toBe('{"ok":false,"reason":"network"}');
    expect(json).not.toContain('sync.example.com');
  });

  it('calls send("sync") with no arguments whatever it was given', async () => {
    const { bridge, send } = setup(async () => ({ messages: [] }));
    await bridge.call('sync', { url: SERVER, force: true });
    await bridge.call('sync');
    expect(send).toHaveBeenCalledTimes(2);
    for (const call of send.mock.calls) expect(call).toEqual(['sync']);
  });

  it('turns a rejection into other, without its message', async () => {
    const json = await setup(async () => {
      throw new Error(`fetch ${SERVER} failed`);
    }).bridge.call('sync');
    expect(JSON.parse(json)).toEqual({ ok: false, reason: 'other' });
    expect(json).not.toContain('sync.example.com');
  });

  it.each(['simplefin-batch-sync', 'accounts-bank-sync'])(
    'refuses the bank sync handler %s',
    async name => {
      const { bridge, send } = setup(async () => ({}));
      await expect(bridge.call(name, {})).rejects.toThrow(name);
      expect(send).not.toHaveBeenCalled();
    },
  );

  // The Swift tests decode this file (SyncTests.swift); a changed shape fails both
  it('matches the contract fixture', async () => {
    const inputs: Record<string, () => Promise<unknown>> = {
      ok: async () => ({ messages: [] }),
      network: failure('network-failure'),
      unauthorized: failure('unauthorized'),
      'out-of-sync': failure('out-of-sync'),
      'clock-drift': failure('clock-drift'),
      encryption: failure('decrypt-failure'),
      other: failure('invalid-schema'),
    };
    const results: Record<string, unknown> = {};
    for (const [key, reply] of Object.entries(inputs)) {
      results[key] = await syncResult(reply);
    }
    await expect(JSON.stringify(results, null, 2) + '\n').toMatchFileSnapshot(
      './fixtures/sync-results.json',
    );
  });
});
