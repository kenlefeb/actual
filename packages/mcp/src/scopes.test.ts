import { existsSync, readFileSync } from 'fs';

import * as api from '@actual-app/api';

import { startHarness } from '#client-harness';

import { SCOPES } from './grants';
import type { Grant, Scope } from './grants';

let h: Awaited<ReturnType<typeof startHarness>>;

afterEach(async () => {
  vi.restoreAllMocks();
  await h.close();
});

const grant = (scopes: Scope[], over: Partial<Grant> = {}): Grant => ({
  scopes,
  confirm_destructive: false,
  ...over,
});

function auditLines() {
  if (!existsSync(h.auditLog)) return [];
  return readFileSync(h.auditLog, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

async function notes() {
  const { data } = (await api.runQuery(
    api.q('transactions').select(['id', 'notes']).orderBy(['date', 'id']),
  )) as { data: Array<{ id: string; notes: string | null }> };
  return data;
}

async function unusedCategory() {
  const group = await api.createCategoryGroup({ name: 'Pets' });
  return api.createCategory({
    name: 'Vet',
    group_id: group,
  } satisfies Parameters<typeof api.createCategory>[0]);
}

const exists = async (id: string) =>
  (await api.getCategories()).some(c => c.id === id);

/** Every write tool and the scopes it needs ("Today's write tools"). */
const NEEDS: Record<string, Scope[]> = {
  write_create_transactions: ['transactions:write'],
  write_update_transactions: ['transactions:write'],
  write_set_budget_amount: ['budget:write'],
  write_skip_paycheck: ['schedules:write'],
  write_move_on_budget: ['structure:write'],
  write_create_category_group: ['structure:write'],
  write_create_category: ['structure:write'],
  write_update_category_group: ['structure:write'],
  write_update_category: ['structure:write'],
  write_move_category_group: ['structure:write'],
  write_move_category: ['structure:write'],
  write_undo: ['budget:read'],
  write_delete_category: ['structure:write', 'delete'],
  write_delete_category_group: ['structure:write', 'delete'],
  write_create_account: ['structure:write'],
  write_update_account: ['structure:write'],
  write_reopen_account: ['structure:write'],
  write_create_account_group: ['structure:write'],
  write_update_account_group: ['structure:write'],
  write_delete_account_group: ['structure:write', 'accounts:delete'],
};

describe('Every tool declares a scope', () => {
  it('A tool without a scope fails the build', async () => {
    h = await startHarness({ count: 1 });
    const { tools } = await h.client.listTools();
    for (const t of tools) {
      const needs = /Needs: ([a-z: ]+)\.$/.exec(t.description ?? '')?.[1];
      expect(needs, t.name).toBeDefined();
      for (const s of needs!.split(' ')) expect(SCOPES).toContain(s);
      if (!t.name.startsWith('write_')) expect(needs).toBe('budget:read');
    }
  });

  it("Today's write tools", async () => {
    h = await startHarness({ count: 1 });
    const { tools } = await h.client.listTools();
    const writes = Object.fromEntries(
      tools
        .filter(t => t.name.startsWith('write_'))
        .map(t => [
          t.name,
          /Needs: ([a-z: ]+)\.$/.exec(t.description ?? '')![1].split(' '),
        ]),
    );
    expect(writes).toEqual(NEEDS);
  });
});

describe('The tool list does not depend on the grant', () => {
  it('A read-only connection sees the write tools', async () => {
    h = await startHarness({ count: 1 }, { grant: grant(['budget:read']) });
    const { tools } = await h.client.listTools();
    const names = tools.map(t => t.name);
    for (const name of Object.keys(NEEDS)) expect(names).toContain(name);
    const byName = Object.fromEntries(tools.map(t => [t.name, t]));
    expect(byName.write_delete_category.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    expect(byName.write_update_transactions.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
    expect(byName.list_transactions.annotations).toMatchObject({
      readOnlyHint: true,
    });
  });
});

describe('A call outside the grant is refused by scope', () => {
  it('refuses a read with no scope, and allows it with budget:read', async () => {
    h = await startHarness({ count: 1 }, { grant: grant([]) });
    const res = await h.call('list_accounts');
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/missing budget:read/);
    expect(res.text).not.toMatch(/not found|unknown tool/i);

    await h.close();
    h = await startHarness({ count: 1 }, { grant: grant(['budget:read']) });
    expect((await h.call('list_accounts')).isError).toBe(false);
  });

  it('refuses each write scope it lacks and allows it once granted', async () => {
    const calls: Array<
      [Scope, string, () => Promise<Record<string, unknown>>]
    > = [
      [
        'transactions:write',
        'write_update_transactions',
        async () => ({ updates: [{ id: (await notes())[0].id, notes: 'x' }] }),
      ],
      [
        'budget:write',
        'write_set_budget_amount',
        async () => ({
          category_id: (await api.getCategories()).find(c => c.name === 'Rent')!
            .id,
          month: '2026-02',
          amount: 100,
        }),
      ],
      [
        'structure:write',
        'write_create_category_group',
        async () => ({ name: 'Travel' }),
      ],
    ];
    for (const [scope, tool, args] of calls) {
      h = await startHarness(
        { count: 1 },
        { grant: grant(SCOPES.filter(s => s !== scope)) },
      );
      const refused = await h.call(tool, await args());
      expect(refused.isError, tool).toBe(true);
      expect(refused.text).toMatch(new RegExp(`missing ${scope}`));
      expect(refused.text).toMatch(/Nothing changed\./);
      await h.close();

      h = await startHarness({ count: 1 }, { grant: grant([scope]) });
      const allowed = await h.call(tool, await args());
      expect(allowed.isError, `${tool}: ${allowed.text}`).toBe(false);
      await h.close();
    }
    h = await startHarness({ count: 1 }, { grant: grant(['budget:read']) });
    const skip = await h.call('write_skip_paycheck', { paycheck_id: 'p' });
    expect(skip.text).toMatch(/missing schedules:write/);
  });

  it('Delete without the delete scope', async () => {
    h = await startHarness(
      { count: 1 },
      { grant: grant(['budget:read', 'structure:write']) },
    );
    const vet = await unusedCategory();
    const res = await h.call('write_delete_category', { category_id: vet });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/missing delete;/);
    expect(res.text).toMatch(/granted budget:read structure:write/);
    expect(await exists(vet)).toBe(true);
  });

  it('accounts:delete alone does not allow a category delete', async () => {
    h = await startHarness(
      { count: 1 },
      {
        grant: grant(['budget:read', 'structure:write', 'accounts:delete']),
      },
    );
    const vet = await unusedCategory();
    const res = await h.call('write_delete_category', { category_id: vet });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/missing delete;/);
    expect(await exists(vet)).toBe(true);
  });

  it('delete and accounts:delete are independent scopes', () => {
    expect(SCOPES).toContain('delete');
    expect(SCOPES).toContain('accounts:delete');
  });

  it('every destructive tool needs delete or accounts:delete', async () => {
    h = await startHarness({ count: 1 });
    const { tools } = await h.client.listTools();
    const destructive = tools.filter(t => t.annotations?.destructiveHint);
    expect(destructive.map(t => t.name)).toEqual(
      expect.arrayContaining([
        'write_delete_category',
        'write_delete_category_group',
        'write_delete_account_group',
      ]),
    );
    for (const t of destructive) {
      // write_undo checks the reversed write's scopes in its handler (design D2)
      if (t.name === 'write_undo') continue;
      expect(t.description, t.name).toMatch(
        /Needs: [a-z: ]*\b(delete|accounts:delete)\b/,
      );
    }
  });

  it('The same call with the scope', async () => {
    h = await startHarness(
      { count: 1 },
      { grant: grant(['budget:read', 'structure:write', 'delete']) },
    );
    const vet = await unusedCategory();
    const res = await h.call('write_delete_category', { category_id: vet });
    expect(res.isError).toBe(false);
    expect(await exists(vet)).toBe(false);
  });
});

describe('Refusals are audit-logged', () => {
  it('A refused write leaves a line', async () => {
    h = await startHarness(
      { count: 1 },
      {
        grant: grant(['budget:read']),
        identity: { user_id: 'user-42', subject: 'local' },
      },
    );
    const [t] = await notes();
    await h.call('write_update_transactions', {
      updates: [{ id: t.id, notes: 'x' }],
    });
    const lines = auditLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      phase: 'refused',
      tool: 'write_update_transactions',
      missing: ['transactions:write'],
      scopes: ['budget:read'],
      user_id: 'user-42',
      subject: 'local',
    });
    expect(JSON.stringify(lines[0])).not.toContain(t.id);
  });

  it('A refusal stands when its line cannot be appended', async () => {
    h = await startHarness({ count: 1 }, { grant: grant(['budget:read']) });
    const [t] = await notes();
    const { chmodSync } = await import('fs');
    chmodSync(h.auditDir, 0o500);
    try {
      const res = await h.call('write_update_transactions', {
        updates: [{ id: t.id, notes: 'x' }],
      });
      expect(res.text).toMatch(/missing transactions:write/);
    } finally {
      chmodSync(h.auditDir, 0o700);
    }
    expect((await notes())[0].notes).toBeNull();
  });
});

describe('audit lines carry the effective scopes', () => {
  it('An audit line names its identity', async () => {
    const scopes: Scope[] = ['budget:read', 'transactions:write'];
    h = await startHarness({ count: 1 }, { grant: grant(scopes) });
    const [t] = await notes();
    await h.call('write_update_transactions', {
      updates: [{ id: t.id, notes: 'x' }],
    });
    const lines = auditLines();
    expect(lines.map(l => l.phase)).toEqual(['attempt', 'outcome']);
    for (const line of lines) {
      expect(line).toMatchObject({ subject: 'local', scopes });
      // A stdio grant has no grants file to fingerprint.
      expect(line).not.toHaveProperty('grant');
    }
  });

  it('records the grants file fingerprint when there is one', async () => {
    h = await startHarness(
      { count: 1 },
      { grant: grant(SCOPES.slice(), { fingerprint: 'abcdef012345' }) },
    );
    const [t] = await notes();
    await h.call('write_update_transactions', {
      updates: [{ id: t.id, notes: 'x' }],
    });
    for (const line of auditLines()) {
      expect(line.grant).toBe('abcdef012345');
    }
  });
});

describe('Confirm before a destructive write', () => {
  const confirming = grant(['budget:read', 'structure:write', 'delete'], {
    confirm_destructive: true,
  });

  it('Dry run then confirm', async () => {
    h = await startHarness({ count: 1 }, { grant: confirming });
    const vet = await unusedCategory();
    const dry = await h.call('write_delete_category', { category_id: vet });
    expect(dry.isError).toBe(false);
    expect(dry.json).toMatchObject({ dry_run: true, ids: [vet] });
    expect(dry.json.text.changes[0]).toMatchObject({ before: 'Vet' });
    expect(typeof dry.json.confirm).toBe('string');
    expect(await exists(vet)).toBe(true);
    expect(auditLines()).toEqual([]);

    const real = await h.call('write_delete_category', {
      category_id: vet,
      confirm: dry.json.confirm,
    });
    expect(real.isError, real.text).toBe(false);
    expect(await exists(vet)).toBe(false);
  });

  it('A stale confirm', async () => {
    h = await startHarness({ count: 1 }, { grant: confirming });
    const vet = await unusedCategory();
    const dry = await h.call('write_delete_category', { category_id: vet });
    await api.updateCategory(vet, { name: 'Vet bills' });
    const res = await h.call('write_delete_category', {
      category_id: vet,
      confirm: dry.json.confirm,
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/budget changed since the dry run/);
    expect(await exists(vet)).toBe(true);
  });

  it('A different call', async () => {
    h = await startHarness({ count: 1 }, { grant: confirming });
    const vet = await unusedCategory();
    const other = await api.createCategory({
      name: 'Toys',
      group_id: (await api.getCategories()).find(c => c.id === vet)!.group_id,
    } satisfies Parameters<typeof api.createCategory>[0]);
    const dry = await h.call('write_delete_category', { category_id: vet });
    const res = await h.call('write_delete_category', {
      category_id: other,
      confirm: dry.json.confirm,
    });
    expect(res.isError).toBe(true);
    expect(await exists(other)).toBe(true);
  });

  it('An expired confirm', async () => {
    h = await startHarness({ count: 1 }, { grant: confirming });
    const vet = await unusedCategory();
    const dry = await h.call('write_delete_category', { category_id: vet });
    const later = Date.now() + 5 * 60_000 + 1000;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    const res = await h.call('write_delete_category', {
      category_id: vet,
      confirm: dry.json.confirm,
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/expired/);
    expect(await exists(vet)).toBe(true);
  });

  it('A confirm from another client', async () => {
    h = await startHarness({ count: 1 }, { grant: confirming, client: 'a' });
    const vet = await unusedCategory();
    const dry = await h.call('write_delete_category', { category_id: vet });
    const second = await h.connectAs('b');
    const res = await second.call('write_delete_category', {
      category_id: vet,
      confirm: dry.json.confirm,
    });
    expect(res.isError).toBe(true);
    expect(await exists(vet)).toBe(true);
  });

  it('runs at once with confirm off', async () => {
    h = await startHarness(
      { count: 1 },
      { grant: { ...confirming, confirm_destructive: false } },
    );
    const vet = await unusedCategory();
    const res = await h.call('write_delete_category', { category_id: vet });
    expect(res.json.deleted).toBe(true);
  });
});

describe('A grant can lower the row cap', () => {
  it('Lowered cap', async () => {
    h = await startHarness(
      { count: 11 },
      { grant: grant(['budget:read', 'transactions:write'], { max_rows: 10 }) },
    );
    const rows = await notes();
    const res = await h.call('write_update_transactions', {
      updates: rows.map(t => ({ id: t.id, notes: 'changed' })),
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/At most 10 rows/);
    expect((await notes()).every(t => t.notes !== 'changed')).toBe(true);
    expect(auditLines()).toEqual([]);

    const ok = await h.call('write_update_transactions', {
      updates: rows.slice(0, 10).map(t => ({ id: t.id, notes: 'changed' })),
    });
    expect(ok.isError).toBe(false);
  });

  it('never raises the cap above 50', async () => {
    h = await startHarness(
      { count: 1 },
      { grant: grant(SCOPES.slice(), { max_rows: 500 }) },
    );
    const { tools } = await h.client.listTools();
    // The input schema still stops at 50 rows whatever the grant says.
    const update = tools.find(t => t.name === 'write_update_transactions')!;
    expect(JSON.stringify(update.inputSchema)).toContain('"maxItems":50');
  });
});
