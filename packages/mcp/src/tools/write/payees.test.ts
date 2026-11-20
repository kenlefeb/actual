import { existsSync, readFileSync } from 'fs';

import * as api from '@actual-app/api';

import { startHarness } from '#client-harness';
import * as connection from '#connection';
import type { Grant, Scope } from '#grants';

import { NOT_UNDOABLE, UNDOABLE } from './declarations';

let h: Awaited<ReturnType<typeof startHarness>>;

afterEach(async () => {
  vi.restoreAllMocks();
  await h.close();
});

const grant = (scopes: Scope[]): Grant => ({
  scopes,
  confirm_destructive: false,
});

async function start(g?: Grant) {
  h = await startHarness({ count: 1 }, g ? { grant: g } : { writes: true });
}

function auditLines() {
  if (!existsSync(h.auditLog)) return [];
  return readFileSync(h.auditLog, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));
}

const payees = () => api.getPayees();
const named = async (name: string) =>
  (await payees()).filter(p => p.name === name);

async function expectRefused(args: Record<string, unknown>, text?: RegExp) {
  const before = JSON.stringify(await payees());
  const logged = auditLines().length;
  const res = await h.call('write_create_payee', args);
  expect(res.isError).toBe(true);
  if (text) expect(res.text).toMatch(text);
  expect(JSON.stringify(await payees())).toBe(before);
  expect(auditLines().length).toBe(logged);
}

describe('write_create_payee', () => {
  it('creates a payee, trimmed, and list_payees shows it', async () => {
    await start();
    const res = await h.call('write_create_payee', { name: ' Car Loan Co ' });
    expect(res.isError, res.text).toBe(false);
    const stored = await named('Car Loan Co');
    expect(stored).toHaveLength(1);
    expect(res.json).toMatchObject({ payee_id: stored[0].id, created: true });
    expect(res.json.text.name).toBe('Car Loan Co');
    const listed = await h.call('list_payees', { search: 'Car Loan' });
    expect(listed.text).toContain('Car Loan Co');
    expect(listed.text).toContain(stored[0].id);
  });

  it('stores what the engine payee-create makes', async () => {
    await start();
    await h.call('write_create_payee', { name: 'Same Shape' });
    const viaTool = (await named('Same Shape'))[0];
    const appId = await api.createPayee({ name: 'Same Shape App' });
    const viaApp = (await payees()).find(p => p.id === appId)!;
    expect({ ...viaTool, id: '', name: '' }).toEqual({
      ...viaApp,
      id: '',
      name: '',
    });
  });

  it('refuses an empty or over-long name, writing no audit line', async () => {
    await start();
    await expectRefused({ name: '   ' }, /1 to 100 characters/);
    await expectRefused({ name: 'x'.repeat(101) }, /1 to 100 characters/);
    const ok = await h.call('write_create_payee', { name: 'y'.repeat(100) });
    expect(ok.isError, ok.text).toBe(false);
  });

  it('returns the existing id for a name ignoring case, writing nothing', async () => {
    await start();
    const first = await h.call('write_create_payee', { name: 'Car Loan Co' });
    const logged = auditLines().length;
    const count = (await payees()).length;
    const again = await h.call('write_create_payee', { name: ' car loan CO ' });
    expect(again.isError, again.text).toBe(false);
    expect(again.json).toMatchObject({
      payee_id: first.json.payee_id,
      created: false,
    });
    expect(again.json.text.name).toBe('Car Loan Co');
    expect(again.json.write_id).toBeUndefined();
    expect((await payees()).length).toBe(count);
    expect(auditLines().length).toBe(logged);
  });

  it("refuses a transfer payee's name", async () => {
    await start();
    const transfer = (await payees()).find(p => p.transfer_acct)!;
    expect(transfer).toBeDefined();
    await expectRefused({ name: transfer.name.toLowerCase() }, /transfer/i);
  });

  it('writes an attempt and an outcome line with the created id', async () => {
    await start();
    const res = await h.call('write_create_payee', { name: 'Audited' });
    const lines = auditLines().filter(l => l.tool === 'write_create_payee');
    expect(lines.map(l => l.phase)).toEqual(['attempt', 'outcome']);
    expect(lines[1].created).toEqual([res.json.payee_id]);
    expect(lines[0].changes).toEqual([
      { id: 'new', field: 'name', before: null, after: 'Audited' },
    ]);
  });

  it('dry_run reports a new name, writing no payee and no audit line', async () => {
    await start();
    const logged = auditLines().length;
    const count = (await payees()).length;
    const res = await h.call('write_create_payee', {
      name: 'Preview',
      dry_run: true,
    });
    expect(res.isError, res.text).toBe(false);
    expect(res.json).toMatchObject({
      dry_run: true,
      created: true,
      payee_id: null,
    });
    expect(res.json.text.name).toBe('Preview');
    expect((await payees()).length).toBe(count);
    expect(auditLines().length).toBe(logged);
  });

  it('dry_run reports an existing payee and its id', async () => {
    await start();
    const first = await h.call('write_create_payee', { name: 'Known' });
    const logged = auditLines().length;
    const res = await h.call('write_create_payee', {
      name: 'known',
      dry_run: true,
    });
    expect(res.json).toMatchObject({
      dry_run: true,
      created: false,
      payee_id: first.json.payee_id,
    });
    expect(res.json.text.name).toBe('Known');
    expect(auditLines().length).toBe(logged);
  });

  it('is refused without structure:write, naming it', async () => {
    await start(grant(['budget:read']));
    const res = await h.call('write_create_payee', { name: 'Nope' });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/structure:write/);
    expect(await named('Nope')).toHaveLength(0);
  });

  it('declares the scope and says write_undo reverses it', async () => {
    await start();
    const tool = (await h.client.listTools()).tools.find(
      t => t.name === 'write_create_payee',
    )!;
    expect(tool.description).toContain('structure:write');
    expect(tool.description).toContain('write_undo reverses it.');
    expect(tool.description).toMatch(/Needs: structure:write\.$/);
    expect(UNDOABLE.write_create_payee).toEqual(['structure:write']);
    expect(NOT_UNDOABLE.write_create_payee).toBeUndefined();
  });

  it('create with a null engine is refused with nothing written', async () => {
    await start();
    const logged = auditLines().length;
    vi.spyOn(connection, 'internal').mockReturnValue(null);
    const res = await h.call('write_create_payee', { name: 'No Engine' });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/Nothing changed/);
    vi.restoreAllMocks();
    expect(await named('No Engine')).toHaveLength(0);
    expect(auditLines().length).toBe(logged);
  });
});

describe('undo of write_create_payee', () => {
  async function made(name = 'Undoable') {
    const res = await h.call('write_create_payee', { name });
    return res.json as { payee_id: string; write_id: string };
  }
  const undo = (write_id: string) => h.call('write_undo', { write_id });

  it('removes an unused payee, once', async () => {
    await start();
    const w = await made();
    const res = await undo(w.write_id);
    expect(res.isError, res.text).toBe(false);
    expect(await named('Undoable')).toHaveLength(0);
    const undoLine = auditLines().find(
      l => l.tool === 'write_undo' && l.undoes === w.write_id,
    );
    expect(undoLine).toBeDefined();
    const second = await undo(w.write_id);
    expect(second.isError).toBe(true);
    expect(second.text).toMatch(/already undone/);
  });

  it('is refused when the name changed', async () => {
    await start();
    const w = await made();
    await api.updatePayee(w.payee_id, { name: 'Renamed' });
    const res = await undo(w.write_id);
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/name/);
    expect(await named('Renamed')).toHaveLength(1);
  });

  it('is refused when a transaction uses it', async () => {
    await start();
    const w = await made();
    const [account] = await api.getAccounts();
    await api.addTransactions(account.id, [
      { date: '2026-01-01', amount: -100, payee: w.payee_id },
    ]);
    const res = await undo(w.write_id);
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/in use/);
    expect(await named('Undoable')).toHaveLength(1);
  });

  it('is refused when a schedule uses it', async () => {
    await start();
    const w = await made();
    await api.createSchedule({
      name: 'Loan',
      payee: w.payee_id,
      account: (await api.getAccounts())[0].id,
      date: { start: '2027-01-01', frequency: 'monthly' },
      amount: -100,
      amountOp: 'is',
    } as never);
    const res = await undo(w.write_id);
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/in use/);
    expect(await named('Undoable')).toHaveLength(1);
  });

  it('is refused when a rule uses it', async () => {
    await start();
    const w = await made();
    await api.createRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ field: 'payee', op: 'is', value: w.payee_id }],
      actions: [{ op: 'set', field: 'notes', value: 'x' }],
    } as never);
    const res = await undo(w.write_id);
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/in use/);
    expect(await named('Undoable')).toHaveLength(1);
  });
});
