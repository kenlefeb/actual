import { appendFileSync, existsSync, readFileSync } from 'fs';

import * as api from '@actual-app/api';

import { startHarness } from '#client-harness';
import { SCOPES } from '#grants';
import type { Limits } from '#limits';

import { declaration, NOT_UNDOABLE, UNDOABLE } from './declarations';
import { budgetId } from './shared';
import { PLANNERS } from './undo';

const ME = { user_id: 'u1', subject: 'sub1' };
const UNKNOWN = /it is unknown, not yours, or not undoable/;

let h: Awaited<ReturnType<typeof startHarness>>;

afterEach(async () => {
  vi.restoreAllMocks();
  await h.close();
});

async function start(limits?: Partial<Limits>, count = 1) {
  h = await startHarness(
    { count },
    {
      grant: { scopes: [...SCOPES], confirm_destructive: false },
      identity: ME,
      limits,
    },
  );
}

function lines() {
  if (!existsSync(h.auditLog)) return [];
  return readFileSync(h.auditLog, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));
}

/** A clean write of `tool` by `who`, attempt and outcome, as `loggedWrite` writes them. */
async function plant(call_id: string, tool: string, who = ME) {
  const base = { ...who, scopes: [], tool, call_id };
  const time = new Date().toISOString();
  appendFileSync(
    h.auditLog,
    `${JSON.stringify({ ...base, time, phase: 'attempt', schema: 2, budget_id: await budgetId(), ids: ['x'], changes: [] })}\n${JSON.stringify({ ...base, time, phase: 'outcome', status: 'ok', applied: ['x'], failed: null, created: [] })}\n`,
  );
}

describe('Every write declares whether it is undoable', () => {
  it('every registered write tool is in exactly one table, and its description says so', async () => {
    await start();
    const writes = (await h.client.listTools()).tools.filter(t =>
      t.name.startsWith('write_'),
    );
    expect(writes.length).toBeGreaterThan(30);
    for (const t of writes) {
      const undoable = t.name in UNDOABLE;
      const not = t.name in NOT_UNDOABLE;
      expect(undoable !== not, `${t.name} is declared once`).toBe(true);
      expect(t.name in PLANNERS, `${t.name} has a planner`).toBe(undoable);
      expect(t.description, t.name).toContain(declaration(t.name)!);
      expect(declaration(t.name)).toBe(
        undoable
          ? 'write_undo reverses it.'
          : `Not undoable: ${NOT_UNDOABLE[t.name]}.`,
      );
    }
    // No table names a tool that is not registered
    const names = writes.map(t => t.name).sort();
    expect(
      [...Object.keys(UNDOABLE), ...Object.keys(NOT_UNDOABLE)].sort(),
    ).toEqual(names);
    expect(Object.keys(PLANNERS).sort()).toEqual(Object.keys(UNDOABLE).sort());
  });

  it('reasons name what a delete loses and cite the planned story', () => {
    expect(NOT_UNDOABLE.write_delete_account).toMatch(/every row/);
    expect(NOT_UNDOABLE.write_delete_account).toMatch(/bank-sync unlink/);
    for (const t of [
      'write_set_budget_carryover',
      'write_update_account',
      'write_reopen_account',
      'write_create_account_group',
      'write_update_account_group',
    ]) {
      expect(NOT_UNDOABLE[t], t).toMatch(/sc-5097/);
    }
    for (const t of [
      'write_apply_budget_templates',
      'write_close_account',
      'write_delete_account',
      'write_move_on_budget',
      'write_reconcile_account',
    ]) {
      expect(t in NOT_UNDOABLE, t).toBe(true);
    }
  });

  it('list_writes and write_undo give the declared reason for my own write', async () => {
    await start();
    await plant('mob', 'write_move_on_budget');
    await plant('tpl', 'write_apply_budget_templates');
    await plant('rec', 'write_reconcile_account');
    await plant('carry', 'write_set_budget_carryover');
    const items = (await h.call('list_writes')).json.writes as Array<{
      write_id: string;
      undoable: boolean;
      reason?: string;
    }>;
    const reasonOf = (id: string) => items.find(w => w.write_id === id)!;
    expect(reasonOf('mob').undoable).toBe(false);
    expect(reasonOf('mob').reason).toMatch(/no move-off-budget action/);
    expect(reasonOf('rec').reason).toMatch(/cannot unlock reconciled rows/);
    for (const [id, reason] of [
      ['mob', /no move-off-budget action/],
      ['tpl', /goals and template automations/],
      ['carry', /sc-5097/],
    ] as const) {
      const before = lines().length;
      const res = await h.call('write_undo', { write_id: id });
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(reason);
      // only the refused line
      expect(
        lines()
          .slice(before)
          .map(l => l.phase),
      ).toEqual(['refused']);
    }
  });

  it("another identity's declared write reads as unknown, with no reason", async () => {
    await start();
    await plant('theirs', 'write_move_on_budget', {
      user_id: 'u2',
      subject: 'sub2',
    });
    const res = await h.call('write_undo', { write_id: 'theirs' });
    expect(res.text).toMatch(UNKNOWN);
    expect(res.text).not.toMatch(/move-off-budget/);
    expect((await h.call('write_undo', { write_id: 'nope' })).text).toMatch(
      UNKNOWN,
    );
  });
});

describe('One write cannot fill the audit tail (its undo too)', () => {
  /** The bytes of the attempt line `run` writes, measured on a fresh budget with the default limit. */
  async function measure(run: () => Promise<unknown>) {
    await start();
    await run();
    const size = Buffer.byteLength(
      JSON.stringify(lines().find(l => l.phase === 'attempt')),
    );
    await h.close();
    return size;
  }

  const firstRow = async () =>
    (
      (await api.runQuery(
        api.q('transactions').select(['id']).orderBy(['date', 'id']),
      )) as { data: Array<{ id: string }> }
    ).data[0].id;

  it('refuses an update whose own line fits but whose undo line would not', async () => {
    const update = async () =>
      h.call('write_update_transactions', {
        updates: [{ id: await firstRow(), notes: 'y'.repeat(200) }],
      });
    const own = await measure(update);
    await start({ maxAuditLineBytes: own + 5 });
    const res = await update();
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(new RegExp(`limit of ${own + 5}`));
    expect(lines()).toEqual([]);
  });

  it('refuses a create whose undo line, naming each created row, would not fit', async () => {
    const create = async () =>
      h.call('write_create_transactions', {
        account_id: h.fixture.accountId,
        transactions: [{ date: '2026-01-05', amount: -100 }],
      });
    const own = await measure(create);
    await start({ maxAuditLineBytes: own + 20 });
    const res = await create();
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/its undo/);
    expect(lines()).toEqual([]);
  });

  // The undo logs each created row as a JSON string, so a quote or backslash costs twice (Security, #449)
  it.each([
    ['quotes', '"'.repeat(1000)],
    ['backslashes and non-ASCII text', '\\"é😀'.repeat(200)],
  ])(
    'a create with notes full of %s is refused up front, or its undo fits',
    async (_, notes) => {
      const create = async () =>
        h.call('write_create_transactions', {
          account_id: h.fixture.accountId,
          transactions: Array.from({ length: 3 }, () => ({
            date: '2026-01-05',
            amount: -100,
            notes,
          })),
        });
      const own = await measure(create);
      // Room for the ids an undo adds, not for notes escaped twice
      await start({ maxAuditLineBytes: own + 500 });
      const res = await create();
      expect(res.isError, 'allowed, but its undo line would not fit').toBe(
        true,
      );
      expect(res.text).toMatch(/its undo/);
    },
  );
});
