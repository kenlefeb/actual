import { PostError } from '#server/errors';
import * as mainApp from '#server/main-app';
import * as prefs from '#server/prefs';
import { fullSync, setSyncingMode } from '#server/sync';
import { handlers } from '#server/tests/mockSyncServer';

// native-budget-screen: "Each refresh failure has a fixed message", Offline
// (sc-3884). What an offline pull gets from loot-core: the failure's own
// sync-event, sent before the call's result, and then the network reason.
// The mock server's untyped routes
const routes: Record<string, unknown> = handlers;

describe('sync with no network', () => {
  const online = routes['/sync/sync'];

  beforeEach(async () => {
    await global.emptyDatabase()();
    await prefs.loadPrefs();
    await prefs.savePrefs({ groupId: 'group', cloudFileId: 'cloud' });
    setSyncingMode('enabled');
    // What post.ts throws when fetch rejects, as in Airplane Mode
    routes['/sync/sync'] = () => {
      throw new PostError('network-failure');
    };
  });

  afterEach(() => {
    routes['/sync/sync'] = online;
    setSyncingMode('disabled');
  });

  it('sends start and the network error event, then returns network-failure', async () => {
    const seen: unknown[] = [];
    const listen = (event: unknown) => seen.push(event);
    mainApp.app.events.on('sync', listen);
    const result = await fullSync();
    seen.push('result');
    mainApp.app.events.off('sync', listen);

    expect(result).toMatchObject({ error: { reason: 'network-failure' } });
    expect(seen).toEqual([
      { type: 'start' },
      { type: 'error', subtype: 'network' },
      'result',
    ]);
  });
});
