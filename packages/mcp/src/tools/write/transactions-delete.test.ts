import { existsSync, readFileSync } from 'fs';

import * as api from '@actual-app/api';
import * as db from '@actual-app/core/server/db/index';

import { startHarness } from '#client-harness';
import { SCOPES } from '#grants';
import type { Grant } from '#grants';
import type { Limits } from '#limits';

let h: Awaited<ReturnType<typeof startHarness>>;

afterEach(async () => {
  vi.restoreAllMocks();
  await h.close();
});

type Tx = {
  id: string;
  account: string;
  amount: number;
  transfer_id: string | null;
  payee: string | null;
  parent_id: string | null;
  reconciled: boolean;
};

async function rows(filter: Record<string, unknown> = {}) {
  const { data } = (await api.runQuery(
    api
      .q('transactions')
      .filter(filter)
      .options({ splits: 'all' })
      .select([
        'id',
        'account',
        'amount',
        'transfer_id',
        'payee',
        'parent_id',
        'reconciled',
      ]),
  )) as { data: Tx[] };
  return data;
}

const alive = async (id: string) => (await rows({ id })).length === 1;

function auditLines() {
  if (!existsSync(h.auditLog)) return [];
  return readFileSync(h.auditLog, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));
}

async function setup(over: Partial<Grant> = {}, limits: Partial<Limits> = {}) {
  h = await startHarness(
    { count: 1 },
    {
      grant: {
        scopes: [...SCOPES],
        confirm_destructive: false,
        ...over,
      },
      limits,
    },
  );
  const checking = h.fixture.accountId;
  const savings = await api.createAccount({ name: 'Savings' }, 0);
  return { checking, savings };
}

async function transferPayee(account: string) {
  const payees = await api.getPayees();
  return payees.find(p => p.transfer_acct === account)!.id;
}

async function transfer(from: string, to: string) {
  await api.addTransactions(
    from,
    [{ date: '2026-11-10', amount: -5000, payee: await transferPayee(to) }],
    { runTransfers: true },
  );
  const out = (await rows({ account: from, amount: -5000 }))[0];
  const into = (await rows({ id: out.transfer_id! }))[0];
  return { out, into };
}

async function split(account: string, amount = 200000) {
  await api.addTransactions(account, [
    {
      date: '2026-11-01',
      amount,
      subtransactions: [{ amount: amount * 0.75 }, { amount: amount * 0.25 }],
    },
  ]);
  const parent = (await rows({ account, amount }))[0];
  const children = await rows({ parent_id: parent.id });
  return { parent, children };
}

const del = (args: Record<string, unknown>) =>
  h.call('write_delete_transactions', args);

describe('write_delete_transactions', () => {
  it('deletes a transfer with its partner', async () => {
    const { checking, savings } = await setup();
    const { out, into } = await transfer(checking, savings);
    const res = await del({ ids: [out.id] });
    expect(res.isError).toBe(false);
    expect(await alive(out.id)).toBe(false);
    expect(await alive(into.id)).toBe(false);
    expect(res.json.deleted).toHaveLength(2);
    expect(res.json.deleted).toEqual(expect.arrayContaining([out.id, into.id]));
  });

  it('counts a split parent and its 2 children against the delete limit (3 rows)', async () => {
    const { checking } = await setup({}, { maxDeleteRows: 2 });
    const { parent } = await split(checking);
    const refused = await del({ ids: [parent.id] });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/At most 2 rows/);
    expect(await alive(parent.id)).toBe(true);
  });

  it('deletes a split parent with its children at a limit of 3 rows + parent', async () => {
    const { checking } = await setup({}, { maxDeleteRows: 3 });
    const { parent, children } = await split(checking);
    // 2 children + the parent = 3 rows
    const ok = await del({ ids: [parent.id] });
    expect(ok.isError).toBe(false);
    expect(ok.json.deleted).toHaveLength(3);
    for (const c of children) expect(await alive(c.id)).toBe(false);
  });

  it('unlinks a partner that is a split child instead of deleting it', async () => {
    const { checking, savings } = await setup();
    const { out, into } = await transfer(checking, savings);
    const sp = await split(savings);
    const child = sp.children[0];
    await db.deleteTransaction({ id: into.id });
    await db.updateTransaction({ id: out.id, transfer_id: child.id });
    await db.updateTransaction({
      id: child.id,
      transfer_id: out.id,
      payee: await transferPayee(checking),
    });
    const res = await del({ ids: [out.id] });
    expect(res.isError).toBe(false);
    expect(await alive(out.id)).toBe(false);
    const [after] = await rows({ id: child.id });
    expect(after.transfer_id).toBeNull();
    expect(after.payee).toBeNull();
    expect(res.json.unlinked).toEqual([child.id]);
    const attempt = auditLines().find(l => l.phase === 'attempt');
    const unlink = attempt.changes.find(
      (c: { field: string }) => c.field === 'unlink',
    );
    expect(unlink.id).toBe(child.id);
    expect(unlink.before).toMatchObject({ transfer_id: out.id });
  });

  it('logs and removes attachments with their row', async () => {
    const { checking } = await setup();
    const [t] = await rows({ account: checking });
    await db.insertWithUUID('transaction_attachments', {
      transaction_id: t.id,
      name: 'r.pdf',
      mime: 'application/pdf',
      size: 1,
      sha256: 'a',
      encrypt_meta: '{}',
      created_at: '2026-11-01T10:00:00.000Z',
    });
    const res = await del({ ids: [t.id] });
    expect(res.isError).toBe(false);
    const attempt = auditLines().find(l => l.phase === 'attempt');
    expect(
      attempt.changes.filter(
        (c: { field: string }) => c.field === 'attachment',
      ),
    ).toHaveLength(1);
    const { data } = (await api.runQuery(
      api.q('transaction_attachments').select('id'),
    )) as { data: unknown[] };
    expect(data).toHaveLength(0);
  });

  it('refuses a split child, naming it and its parent', async () => {
    const { checking } = await setup();
    const { parent, children } = await split(checking);
    const res = await del({ ids: [children[0].id] });
    expect(res.isError).toBe(true);
    expect(res.text).toContain(children[0].id);
    expect(res.text).toContain(parent.id);
    expect(await alive(children[0].id)).toBe(true);
  });

  it('refuses an unknown or already deleted id and changes nothing', async () => {
    const { checking } = await setup();
    const [t] = await rows({ account: checking });
    const res = await del({ ids: [t.id, 'nope'] });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('nope');
    expect(await alive(t.id)).toBe(true);
    await del({ ids: [t.id] });
    const again = await del({ ids: [t.id] });
    expect(again.isError).toBe(true);
  });

  it('refuses a reconciled row without the override, allows it with the grant option and the call override', async () => {
    const { checking } = await setup({ allow_reconciled: true });
    const [t] = await rows({ account: checking });
    await api.updateTransaction(t.id, { cleared: true, reconciled: true });
    const refused = await del({ ids: [t.id] });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain(t.id);
    expect(refused.text).toMatch(/reconciled/);
    expect(await alive(t.id)).toBe(true);
    const ok = await del({ ids: [t.id], allow_reconciled: true });
    expect(ok.isError).toBe(false);
    expect(await alive(t.id)).toBe(false);
  });

  it('refuses the override when the grant does not allow it', async () => {
    const { checking } = await setup();
    const [t] = await rows({ account: checking });
    await api.updateTransaction(t.id, { cleared: true, reconciled: true });
    const res = await del({ ids: [t.id], allow_reconciled: true });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/grant does not allow/);
    expect(await alive(t.id)).toBe(true);
  });

  it('refuses a reconciled transfer partner', async () => {
    const { checking, savings } = await setup();
    const { out, into } = await transfer(checking, savings);
    await api.updateTransaction(into.id, { cleared: true, reconciled: true });
    const res = await del({ ids: [out.id] });
    expect(res.isError).toBe(true);
    expect(res.text).toContain(into.id);
    expect(await alive(out.id)).toBe(true);
    expect(await alive(into.id)).toBe(true);
  });

  it("refuses a split whose child's transfer partner is reconciled", async () => {
    const { checking, savings } = await setup();
    const { out, into } = await transfer(checking, savings);
    const sp = await split(checking, 300000);
    const child = sp.children[0];
    await db.deleteTransaction({ id: out.id });
    await db.updateTransaction({ id: into.id, transfer_id: child.id });
    await db.updateTransaction({ id: child.id, transfer_id: into.id });
    await api.updateTransaction(into.id, { cleared: true, reconciled: true });
    const res = await del({ ids: [sp.parent.id] });
    expect(res.isError).toBe(true);
    expect(res.text).toContain(into.id);
    expect(await alive(sp.parent.id)).toBe(true);
    expect(await alive(child.id)).toBe(true);
  });

  it('refuses when a partner child it would unlink is reconciled', async () => {
    const { checking, savings } = await setup();
    const { out, into } = await transfer(checking, savings);
    const sp = await split(savings);
    const child = sp.children[0];
    await db.deleteTransaction({ id: into.id });
    await db.updateTransaction({ id: out.id, transfer_id: child.id });
    await db.updateTransaction({
      id: child.id,
      transfer_id: out.id,
      reconciled: true,
    });
    const res = await del({ ids: [out.id] });
    expect(res.isError).toBe(true);
    expect(res.text).toContain(child.id);
    expect(await alive(out.id)).toBe(true);
  });

  it('is refused by scope without delete', async () => {
    const { checking } = await setup({
      scopes: SCOPES.filter(s => s !== 'delete'),
    });
    const [t] = await rows({ account: checking });
    const res = await del({ ids: [t.id] });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/missing delete/);
    expect(await alive(t.id)).toBe(true);
  });

  it('dry-runs under confirm_destructive and deletes with the confirm', async () => {
    const { checking, savings } = await setup({ confirm_destructive: true });
    const { out, into } = await transfer(checking, savings);
    const first = await del({ ids: [out.id] });
    expect(first.json.dry_run).toBe(true);
    expect(first.json.ids).toEqual(expect.arrayContaining([out.id, into.id]));
    expect(await alive(out.id)).toBe(true);
    expect(auditLines()).toHaveLength(0);
    const second = await del({ ids: [out.id], confirm: first.json.confirm });
    expect(second.isError).toBe(false);
    expect(await alive(out.id)).toBe(false);
    expect(await alive(into.id)).toBe(false);
  });

  it('logs the rows, their values and the budget on the attempt line', async () => {
    const { checking, savings } = await setup();
    const { out, into } = await transfer(checking, savings);
    const res = await del({ ids: [out.id] });
    const [attempt, outcome] = auditLines();
    expect(attempt).toMatchObject({
      tool: 'write_delete_transactions',
      phase: 'attempt',
      schema: 2,
    });
    expect(typeof attempt.budget_id).toBe('string');
    expect(attempt.budget_id.length).toBeGreaterThan(0);
    const logged = attempt.changes.filter(
      (c: { field: string }) => c.field === 'transaction',
    );
    expect(logged.map((c: { id: string }) => c.id).sort()).toEqual(
      [out.id, into.id].sort(),
    );
    const outRow = logged.find((c: { id: string }) => c.id === out.id);
    expect(outRow.before).toMatchObject({
      account: checking,
      date: '2026-11-10',
      transfer_id: into.id,
    });
    expect(outRow.after).toBeNull();
    expect(outcome.applied).toHaveLength(2);
    expect(outcome.applied).toEqual(expect.arrayContaining([out.id, into.id]));
    expect(res.json.write_id).toBe(attempt.call_id);
  });

  it('refuses before any audit line when its own line would not fit', async () => {
    const { checking } = await setup({}, { maxAuditLineBytes: 300 });
    const [t] = await rows({ account: checking });
    const res = await del({ ids: [t.id] });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/audit line/);
    expect(auditLines()).toHaveLength(0);
    expect(await alive(t.id)).toBe(true);
  });

  it("refuses before any audit line when the undo's line would not fit", async () => {
    // The delete's own line fits at this size; the undo's, which also carries
    // `undoes` and the restored values, must not
    const probe = await setup();
    const [p] = await rows({ account: probe.checking });
    await del({ ids: [p.id] });
    // The size loggedWrite checks: the logged line without time, call id, phase, schema
    const { time, call_id, phase, schema, ...checked } = auditLines()[0];
    void [time, call_id, phase, schema];
    const size = Buffer.byteLength(JSON.stringify(checked));
    await h.close();

    const { checking } = await setup({}, { maxAuditLineBytes: size });
    const [t] = await rows({ account: checking });
    const res = await del({ ids: [t.id] });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/undo/);
    expect(auditLines()).toHaveLength(0);
    expect(await alive(t.id)).toBe(true);
  });

  it('cannot be undone yet: write_undo refuses it as not undoable', async () => {
    const { checking } = await setup();
    const [t] = await rows({ account: checking });
    const res = await del({ ids: [t.id] });
    const undo = await h.call('write_undo', { write_id: res.json.write_id });
    expect(undo.isError).toBe(true);
    expect(undo.text).toMatch(/cannot be undone/);
    expect(await alive(t.id)).toBe(false);
    const listed = (await h.call('list_writes')).json.writes[0];
    expect(listed.undoable).toBe(false);
  });
});
