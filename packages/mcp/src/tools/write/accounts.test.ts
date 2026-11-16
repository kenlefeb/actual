import { existsSync, readFileSync } from 'fs';

import * as api from '@actual-app/api';

import { startHarness } from '#client-harness';
import type { Grant, Scope } from '#grants';

let h: Awaited<ReturnType<typeof startHarness>>;

afterEach(async () => {
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

const accounts = () => api.getAccounts();
const groups = () => api.getAccountGroups();
const account = async (name: string) =>
  (await accounts()).find(a => a.name === name)!;
const group = async (name: string) =>
  (await groups()).find(g => g.name === name)!;

/** Runs a call that must be refused: error, matching text, nothing changed, no audit line. */
async function expectRefused(
  tool: string,
  args: Record<string, unknown>,
  text?: RegExp,
) {
  const before = JSON.stringify([await accounts(), await groups()]);
  const logged = auditLines().length;
  const res = await h.call(tool, args);
  expect(res.isError).toBe(true);
  if (text) expect(res.text).toMatch(text);
  expect(JSON.stringify([await accounts(), await groups()])).toBe(before);
  expect(auditLines().length).toBe(logged);
}

/** A closed account (it had a balance, moved to Checking). */
async function closedAccount(name: string) {
  const id = await api.createAccount({ name, offbudget: false }, 5000);
  await api.closeAccount(id, (await account('Checking')).id);
  return id;
}

describe('account and group reads', () => {
  beforeEach(async () => {
    h = await startHarness({ count: 1 }, { writes: true });
  });

  it('Accounts carry their group, null when ungrouped', async () => {
    const g = await api.createAccountGroup({ name: 'Cash' });
    const wallet = await api.createAccount({
      name: 'Wallet',
      offbudget: false,
    });
    await api.updateAccount(wallet, { account_group_id: g });
    const rows = (await h.call('list_accounts')).json.items;
    const byName = (n: string) =>
      rows.find((r: { text: { name: string } }) => r.text.name === n);
    expect(byName('Wallet').account_group_id).toBe(g);
    expect(byName('Checking').account_group_id).toBeNull();
  });

  it('Groups are listed with their account ids and sanitized names', async () => {
    const g = await api.createAccountGroup({ name: 'Cash' });
    await api.createAccountGroup({ name: 'Empty' });
    const wallet = await api.createAccount({
      name: 'Wallet',
      offbudget: false,
    });
    await api.updateAccount(wallet, { account_group_id: g });
    const res = await h.call('list_account_groups');
    expect(res.isError).toBe(false);
    const cash = res.json.items.find((x: { id: string }) => x.id === g);
    expect(cash.text.name).toBe('Cash');
    expect(cash.account_ids).toEqual([wallet]);
    const empty = res.json.items.find(
      (x: { text: { name: string } }) => x.text.name === 'Empty',
    );
    expect(empty.account_ids).toEqual([]);
  });

  it('A read-only grant lists groups', async () => {
    await h.close();
    h = await startHarness({ count: 1 }, { grant: grant(['budget:read']) });
    expect((await h.call('list_account_groups')).isError).toBe(false);
  });
});

describe('account maintenance tools', () => {
  beforeEach(async () => {
    h = await startHarness({ count: 1 }, { writes: true });
  });

  it('Create an account with an opening balance', async () => {
    const res = await h.call('write_create_account', {
      name: 'Holiday Fund',
      off_budget: false,
      opening_balance: 50000,
    });
    expect(res.isError).toBe(false);
    const made = await account('Holiday Fund');
    expect(res.json.account_id).toBe(made.id);
    expect(made.offbudget).toBe(false);
    expect(await api.getAccountBalance(made.id)).toBe(50000);
    const lines = auditLines();
    expect(lines.map(l => l.phase)).toEqual(['attempt', 'outcome']);
    expect(lines[1].created).toEqual([made.id]);
  });

  it('The result matches the app on the same budget', async () => {
    await h.call('write_create_account', {
      name: 'Via tool',
      off_budget: true,
      opening_balance: 1234,
    });
    await api.createAccount({ name: 'Via app', offbudget: true }, 1234);
    const [tool, app] = [await account('Via tool'), await account('Via app')];
    expect(await api.getAccountBalance(tool.id)).toBe(
      await api.getAccountBalance(app.id),
    );
    const { id: _a, name: _b, ...toolRest } = tool;
    const { id: _c, name: _d, ...appRest } = app;
    expect(toolRest).toEqual(appRest);

    await h.call('write_update_account', {
      account_id: tool.id,
      name: 'Renamed tool',
    });
    await api.updateAccount(app.id, { name: 'Renamed app' });
    const { id: _e, name: _f, ...toolAfter } = await account('Renamed tool');
    const { id: _g, name: _i, ...appAfter } = await account('Renamed app');
    expect(toolAfter).toEqual(appAfter);
  });

  it('A duplicate account name is allowed, with a warning', async () => {
    const first = await account('Checking');
    const res = await h.call('write_create_account', { name: 'checking' });
    expect(res.isError).toBe(false);
    expect(
      (await accounts()).filter(a => a.name.toLowerCase() === 'checking'),
    ).toHaveLength(2);
    expect(JSON.stringify(res.json.warnings)).toContain(first.id);
  });

  it('An empty name is refused', async () => {
    await expectRefused('write_create_account', { name: '   ' });
  });

  it('Create cannot be closed', async () => {
    await expectRefused('write_create_account', { name: 'Nope', closed: true });
    expect((await accounts()).some(a => a.name === 'Nope')).toBe(false);
  });

  it('An opening balance must be a sane integer of cents', async () => {
    await expectRefused('write_create_account', {
      name: 'X',
      opening_balance: 1.5,
    });
  });

  it('Rename and group, then ungroup', async () => {
    const g = await api.createAccountGroup({ name: 'Cash' });
    const checking = await account('Checking');
    const res = await h.call('write_update_account', {
      account_id: checking.id,
      name: 'Everyday',
      account_group_id: g,
    });
    expect(res.isError).toBe(false);
    expect(res.json.text.name).toMatchObject({
      before: 'Checking',
      after: 'Everyday',
    });
    expect(res.json.account_group_id).toEqual({ before: null, after: g });
    expect((await account('Everyday')).account_group_id).toBe(g);

    const back = await h.call('write_update_account', {
      account_id: checking.id,
      account_group_id: null,
    });
    expect(back.json.account_group_id).toEqual({ before: g, after: null });
    expect((await account('Everyday')).account_group_id).toBeNull();
    expect(auditLines().map(l => l.phase)).toEqual([
      'attempt',
      'outcome',
      'attempt',
      'outcome',
    ]);
  });

  it('A closed account can be renamed', async () => {
    const id = await closedAccount('Old');
    const res = await h.call('write_update_account', {
      account_id: id,
      name: 'Older',
    });
    expect(res.isError).toBe(false);
    expect((await account('Older')).closed).toBe(true);
  });

  it('Update cannot close or move off budget', async () => {
    const checking = await account('Checking');
    for (const extra of [
      { closed: true },
      { off_budget: true },
      { offbudget: true },
    ]) {
      await expectRefused('write_update_account', {
        account_id: checking.id,
        name: 'Changed',
        ...extra,
      });
    }
    const after = await account('Checking');
    expect(after.closed).toBe(false);
    expect(after.offbudget).toBe(false);
  });

  it('Update needs a name or a group', async () => {
    const checking = await account('Checking');
    await expectRefused('write_update_account', { account_id: checking.id });
    await expectRefused('write_update_account', {
      account_id: checking.id,
      name: ' ',
    });
  });

  it('An unknown id, a name or an unknown group is refused', async () => {
    const checking = await account('Checking');
    await expectRefused('write_update_account', {
      account_id: 'nope',
      name: 'X',
    });
    await expectRefused('write_update_account', {
      account_id: 'Checking',
      name: 'X',
    });
    await expectRefused('write_update_account', {
      account_id: checking.id,
      account_group_id: 'nope',
    });
    await expectRefused('write_reopen_account', { account_id: 'Checking' });
  });

  it('Reopen a closed account', async () => {
    const id = await closedAccount('Old');
    const res = await h.call('write_reopen_account', { account_id: id });
    expect(res.isError).toBe(false);
    expect(res.json.closed).toEqual({ before: true, after: false });
    expect((await account('Old')).closed).toBe(false);
    expect(auditLines().map(l => l.phase)).toEqual(['attempt', 'outcome']);
  });

  it('Reopening an open account is refused', async () => {
    await expectRefused('write_reopen_account', {
      account_id: (await account('Checking')).id,
    });
  });

  it('The tools need structure:write', async () => {
    await h.close();
    h = await startHarness({ count: 1 }, { grant: grant(['budget:read']) });
    const checking = await account('Checking');
    for (const [tool, args] of [
      ['write_create_account', { name: 'X' }],
      ['write_update_account', { account_id: checking.id, name: 'X' }],
      ['write_reopen_account', { account_id: checking.id }],
    ] as const) {
      const res = await h.call(tool, args);
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/missing structure:write/);
    }
    expect((await accounts()).map(a => a.name)).toEqual(['Checking']);
  });
});

describe('account group tools', () => {
  beforeEach(async () => {
    h = await startHarness({ count: 1 }, { writes: true });
  });

  it('Create and rename', async () => {
    const made = await h.call('write_create_account_group', { name: 'Cash' });
    expect(made.isError).toBe(false);
    const gid = made.json.account_group_id;
    expect((await group('Cash')).id).toBe(gid);
    const renamed = await h.call('write_update_account_group', {
      account_group_id: gid,
      name: 'Everyday',
    });
    expect(renamed.json.text.name).toEqual({
      before: 'Cash',
      after: 'Everyday',
    });
    expect((await groups()).map(g => g.name)).toEqual(['Everyday']);
    expect(auditLines().map(l => l.phase)).toEqual([
      'attempt',
      'outcome',
      'attempt',
      'outcome',
    ]);
    expect(auditLines()[1].created).toEqual([gid]);
  });

  it('A duplicate or empty group name is refused', async () => {
    await api.createAccountGroup({ name: 'Cash' });
    const other = await api.createAccountGroup({ name: 'Other' });
    await expectRefused(
      'write_create_account_group',
      { name: 'cash' },
      /already/,
    );
    await expectRefused(
      'write_update_account_group',
      { account_group_id: other, name: 'CASH' },
      /already/,
    );
    await expectRefused('write_create_account_group', { name: '  ' });
  });

  it('Renaming a group to its own name differently cased is allowed', async () => {
    const gid = await api.createAccountGroup({ name: 'Cash' });
    const res = await h.call('write_update_account_group', {
      account_group_id: gid,
      name: 'CASH',
    });
    expect(res.isError).toBe(false);
  });

  it('An unknown id or a name is refused', async () => {
    await api.createAccountGroup({ name: 'Cash' });
    await expectRefused('write_update_account_group', {
      account_group_id: 'Cash',
      name: 'X',
    });
    await expectRefused('write_delete_account_group', {
      account_group_id: 'Cash',
    });
  });

  it('Extra keys are refused', async () => {
    await expectRefused('write_create_account_group', {
      name: 'X',
      hidden: true,
    });
  });

  it('Delete a group with accounts leaves them ungrouped', async () => {
    const gid = await api.createAccountGroup({ name: 'Cash' });
    const checking = await account('Checking');
    const wallet = await api.createAccount({
      name: 'Wallet',
      offbudget: false,
    });
    await api.updateAccount(checking.id, { account_group_id: gid });
    await api.updateAccount(wallet, { account_group_id: gid });
    const res = await h.call('write_delete_account_group', {
      account_group_id: gid,
    });
    expect(res.isError).toBe(false);
    expect(res.json.ungrouped_account_ids.sort()).toEqual(
      [checking.id, wallet].sort(),
    );
    expect(await groups()).toEqual([]);
    const after = await accounts();
    expect(after).toHaveLength(2);
    expect(after.every(a => a.account_group_id === null && !a.closed)).toBe(
      true,
    );
    const attempt = auditLines()[0];
    expect(attempt.ids).toEqual(expect.arrayContaining([gid, wallet]));
  });

  it('Delete needs the accounts:delete scope', async () => {
    await h.close();
    h = await startHarness(
      { count: 1 },
      { grant: grant(['budget:read', 'structure:write']) },
    );
    const gid = await api.createAccountGroup({ name: 'Cash' });
    const res = await h.call('write_delete_account_group', {
      account_group_id: gid,
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/missing accounts:delete/);
    expect(await groups()).toHaveLength(1);
  });

  it('Create and rename need structure:write', async () => {
    await h.close();
    h = await startHarness({ count: 1 }, { grant: grant(['budget:read']) });
    for (const [tool, args] of [
      ['write_create_account_group', { name: 'X' }],
      ['write_update_account_group', { account_group_id: 'x', name: 'X' }],
    ] as const) {
      const res = await h.call(tool, args);
      expect(res.text).toMatch(/missing structure:write/);
    }
  });

  it('The delete is annotated destructive', async () => {
    const byName = Object.fromEntries(
      (await h.client.listTools()).tools.map(t => [t.name, t]),
    );
    expect(byName.write_delete_account_group.annotations).toMatchObject({
      destructiveHint: true,
    });
    expect(byName.write_create_account_group.annotations).toMatchObject({
      destructiveHint: false,
    });
  });

  describe('under confirm_destructive', () => {
    beforeEach(async () => {
      await h.close();
      h = await startHarness(
        { count: 1 },
        {
          grant: grant(['budget:read', 'structure:write', 'accounts:delete'], {
            confirm_destructive: true,
          }),
        },
      );
    });

    it('A dry run lists the accounts it would ungroup, then confirm deletes', async () => {
      const gid = await api.createAccountGroup({ name: 'Cash' });
      const checking = await account('Checking');
      await api.updateAccount(checking.id, { account_group_id: gid });
      const dry = await h.call('write_delete_account_group', {
        account_group_id: gid,
      });
      expect(dry.json.dry_run).toBe(true);
      expect(dry.json.ids).toEqual(expect.arrayContaining([gid, checking.id]));
      expect(await groups()).toHaveLength(1);
      expect(auditLines()).toEqual([]);

      const done = await h.call('write_delete_account_group', {
        account_group_id: gid,
        confirm: dry.json.confirm,
      });
      expect(done.isError).toBe(false);
      expect(await groups()).toEqual([]);
    });

    it('A stale confirm', async () => {
      const gid = await api.createAccountGroup({ name: 'Cash' });
      const dry = await h.call('write_delete_account_group', {
        account_group_id: gid,
      });
      const wallet = await api.createAccount({
        name: 'Wallet',
        offbudget: false,
      });
      await api.updateAccount(wallet, { account_group_id: gid });
      const res = await h.call('write_delete_account_group', {
        account_group_id: gid,
        confirm: dry.json.confirm,
      });
      expect(res.isError).toBe(true);
      expect(await groups()).toHaveLength(1);
    });
  });
});
