import { existsSync, readFileSync } from 'fs';

import * as api from '@actual-app/api';
import * as db from '@actual-app/core/server/db/index';

import { startHarness } from '#client-harness';
import { SCOPES } from '#grants';

let h: Awaited<ReturnType<typeof startHarness>>;

afterEach(async () => {
  vi.restoreAllMocks();
  await h.close();
});

/** confirm_destructive off: only the always-confirm rule can ask for a dry run. */
async function start() {
  h = await startHarness(
    { count: 1 },
    { grant: { scopes: [...SCOPES], confirm_destructive: false } },
  );
}

function auditLines() {
  if (!existsSync(h.auditLog)) return [];
  return readFileSync(h.auditLog, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));
}

const open = async (id: string) =>
  (await api.getAccounts()).find(a => a.id === id && !a.closed);

/** An empty-balance account with one transaction, so a close closes rather than deletes. */
async function account(name: string) {
  const id = await api.createAccount({ name }, 0);
  await api.addTransactions(id, [{ date: '2026-01-02', amount: 0 }]);
  return id;
}

const link = (id: string, on: boolean) =>
  db.update('accounts', {
    id,
    account_id: on ? 'ext-1' : null,
    account_sync_source: on ? 'simpleFin' : null,
  });

async function expectDryRun(tool: string, args: Record<string, unknown>) {
  const res = await h.call(tool, args);
  expect(res.isError, res.text).toBe(false);
  expect(res.json.dry_run).toBe(true);
  expect(typeof res.json.confirm).toBe('string');
  expect(auditLines()).toEqual([]);
  return res;
}

describe('Permanent actions always confirm', () => {
  it('closing a bank-linked account dry-runs with confirm off, saying the unlink cannot be undone', async () => {
    await start();
    const id = await account('Linked');
    // Linked in the app after the client last read it
    await link(id, true);
    const res = await expectDryRun('write_close_account', { account_id: id });
    expect(res.text).toMatch(/bank sync.*cannot be undone/i);
    expect(await open(id)).toBeDefined();
  });

  it('deleting a bank-linked account dry-runs with confirm off', async () => {
    await start();
    const id = await account('Linked');
    await link(id, true);
    await expectDryRun('write_delete_account', { account_id: id });
    expect(await open(id)).toBeDefined();
  });

  it('an unlinked account closes in one call', async () => {
    await start();
    const id = await account('Plain');
    const res = await h.call('write_close_account', { account_id: id });
    expect(res.isError, res.text).toBe(false);
    expect(await open(id)).toBeUndefined();
  });

  it('a confirm from before the link changed is stale', async () => {
    await start();
    const id = await account('Linked');
    await link(id, true);
    const dry = await expectDryRun('write_close_account', { account_id: id });
    await link(id, false);
    const res = await h.call('write_close_account', {
      account_id: id,
      confirm: dry.json.confirm,
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/confirm expired|changed since the dry run/);
    expect(await open(id)).toBeDefined();
    expect(auditLines()).toEqual([]);
  });

  it('a link that cannot be read counts as linked', async () => {
    await start();
    const id = await account('Unknown');
    const real = api.runQuery;
    vi.spyOn(api, 'runQuery').mockImplementation((async (
      q: Parameters<typeof api.runQuery>[0],
    ) => {
      if (JSON.stringify(q).includes('account_sync_source')) {
        throw new Error('unreadable');
      }
      return real(q);
    }) as typeof api.runQuery);
    await expectDryRun('write_delete_account', { account_id: id });
    expect(await open(id)).toBeDefined();
  });

  it('applying templates dry-runs with confirm off, then writes on confirm', async () => {
    await start();
    const group = (await api.getCategoryGroups()).find(
      g => g.name === 'Bills',
    )!;
    const cat = await api.createCategory({
      name: 'T',
      group_id: group.id,
    } satisfies Parameters<typeof api.createCategory>[0]);
    await api.updateNote(cat, '#template 100');
    const args = { month: '2026-03' };
    const dry = await expectDryRun('write_apply_budget_templates', args);
    expect(JSON.stringify(dry.json)).toContain(`${cat}:2026-03`);
    const done = await h.call('write_apply_budget_templates', {
      ...args,
      confirm: dry.json.confirm,
    });
    expect(done.isError, done.text).toBe(false);
    expect(done.json.applied).toContain(`${cat}:2026-03`);
  });
});
