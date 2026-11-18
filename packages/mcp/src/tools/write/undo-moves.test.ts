import { appendFileSync, existsSync, readFileSync } from 'fs';

import * as api from '@actual-app/api';

import { startHarness } from '#client-harness';
import { SCOPES } from '#grants';
import type { Grant, Scope } from '#grants';

import { budgetId } from './shared';

const ME = { user_id: 'u1', subject: 'sub1' };
const FIX_CATEGORY =
  /stays where it is; move it by hand with write_move_category, or tell the budget's owner/;

let h: Awaited<ReturnType<typeof startHarness>>;
let live: Grant;

afterEach(async () => {
  vi.restoreAllMocks();
  await h.close();
});

async function setup(over: Partial<Grant> = {}) {
  live = { scopes: [...SCOPES], confirm_destructive: false, ...over };
  h = await startHarness({ count: 1 }, { grant: live, identity: ME });
  // The fixture has no sync server
  return vi.spyOn(api, 'sync').mockResolvedValue(undefined);
}

function lines() {
  if (!existsSync(h.auditLog)) return [];
  return readFileSync(h.auditLog, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));
}

/** A new group holding categories in the given order (new categories are listed first). */
async function group(
  name: string,
  cats: string[] = [],
): Promise<Record<string, string>> {
  const g = await api.createCategoryGroup({ name });
  const ids: Record<string, string> = {};
  for (const c of [...cats].reverse()) {
    ids[c] = await api.createCategory({
      name: c,
      group_id: g,
    } satisfies Parameters<typeof api.createCategory>[0]);
  }
  return { id: g, ...ids };
}

async function names(groupId: string) {
  const g = (await api.getCategoryGroups()).find(x => x.id === groupId);
  return (g?.categories ?? []).map(c => c.name);
}

/** Group ids in the engine's order (sort order, income groups included). */
async function groupOrder() {
  const { data } = (await api.runQuery(
    api
      .q('category_groups')
      .filter({ tombstone: false })
      .orderBy(['sort_order', 'id'])
      .select(['id']),
  )) as { data: Array<{ id: string }> };
  return data.map(g => g.id);
}

async function write(tool: string, args: Record<string, unknown>) {
  const res = await h.call(tool, args);
  expect(res.isError, res.text).toBe(false);
  return res.json as { write_id: string } & Record<string, unknown>;
}

const changesOf = (writeId: string) =>
  lines().find(l => l.call_id === writeId && l.phase === 'attempt')!.changes;

const undo = (write_id: string) => h.call('write_undo', { write_id });

async function expectRefusedUndo(writeId: string, text: RegExp) {
  const before = JSON.stringify(await api.getCategoryGroups());
  const res = await undo(writeId);
  expect(res.isError).toBe(true);
  expect(res.text).toMatch(text);
  expect(JSON.stringify(await api.getCategoryGroups())).toBe(before);
  return res.text;
}

/** A planted move write by this identity, attempt and clean outcome. */
async function plantMove(
  call_id: string,
  tool: string,
  ids: unknown,
  changes: unknown,
) {
  const base = { ...ME, scopes: [], tool, call_id };
  appendFileSync(
    h.auditLog,
    `${JSON.stringify({ ...base, time: new Date().toISOString(), phase: 'attempt', schema: 2, budget_id: await budgetId(), ids, changes })}\n${JSON.stringify({ ...base, time: new Date().toISOString(), phase: 'outcome', status: 'ok', applied: ids, failed: null, created: [] })}\n`,
  );
}

describe('Moves log their old place', () => {
  it('a category moved from the middle', async () => {
    await setup();
    const x = await group('X', ['A', 'B', 'C']);
    const y = await group('Y', ['D']);
    const w = await write('write_move_category', {
      category_id: x.B,
      group_id: y.id,
      before_category_id: y.D,
    });
    expect(changesOf(w.write_id)).toEqual([
      { id: x.B, field: 'group_id', before: x.id, after: y.id },
      { id: x.B, field: 'next_category_id', before: x.C, after: y.D },
    ]);
  });

  it('a category moved from the end, and within its group', async () => {
    await setup();
    const x = await group('X', ['A', 'B', 'C']);
    const y = await group('Y');
    const last = await write('write_move_category', {
      category_id: x.C,
      group_id: y.id,
    });
    expect(changesOf(last.write_id)).toEqual([
      { id: x.C, field: 'group_id', before: x.id, after: y.id },
      { id: x.C, field: 'next_category_id', before: null, after: null },
    ]);
    const within = await write('write_move_category', {
      category_id: x.B,
      group_id: x.id,
      before_category_id: x.A,
    });
    expect(changesOf(within.write_id)).toEqual([
      { id: x.B, field: 'group_id', before: x.id, after: x.id },
      { id: x.B, field: 'next_category_id', before: null, after: x.A },
    ]);
  });

  it('a group moved from the end and from the middle', async () => {
    await setup();
    await group('X');
    await group('Y');
    await group('Z');
    const order = await groupOrder();
    const [first, second, third] = order;
    const lastId = order[order.length - 1];
    const end = await write('write_move_category_group', {
      group_id: lastId,
      before_group_id: first,
    });
    expect(changesOf(end.write_id)).toEqual([
      { id: lastId, field: 'next_group_id', before: null, after: first },
    ]);
    const middle = await write('write_move_category_group', {
      group_id: second,
    });
    expect(changesOf(middle.write_id)).toEqual([
      { id: second, field: 'next_group_id', before: third, after: null },
    ]);
    for (const l of lines()) {
      expect(JSON.stringify(l.changes ?? [])).not.toMatch(
        /before_category_id|before_group_id/,
      );
    }
  });
});

describe('Undo of a move', () => {
  it('undoes a category move between groups', async () => {
    await setup();
    const x = await group('X', ['A', 'B', 'C']);
    const y = await group('Y', ['D']);
    const w = await write('write_move_category', {
      category_id: x.B,
      group_id: y.id,
      before_category_id: y.D,
    });
    const u = await write('write_undo', { write_id: w.write_id });
    expect(await names(x.id)).toEqual(['A', 'B', 'C']);
    expect(await names(y.id)).toEqual(['D']);
    const line = lines().find(
      l => l.call_id === u.write_id && l.phase === 'attempt',
    );
    expect(line.undoes).toBe(w.write_id);
    expect(line.changes).toEqual([
      { id: x.B, field: 'group_id', before: y.id, after: x.id },
      { id: x.B, field: 'next_category_id', before: y.D, after: x.C },
    ]);
    // once only
    expect((await undo(w.write_id)).text).toMatch(/already undone/);
  });

  it('undoes a reorder within one group', async () => {
    await setup();
    const x = await group('X', ['A', 'B', 'C']);
    const w = await write('write_move_category', {
      category_id: x.C,
      group_id: x.id,
      before_category_id: x.A,
    });
    expect(await names(x.id)).toEqual(['C', 'A', 'B']);
    await write('write_undo', { write_id: w.write_id });
    expect(await names(x.id)).toEqual(['A', 'B', 'C']);
  });

  it('undoes a group move', async () => {
    await setup();
    await group('X');
    await group('Z');
    const order = await groupOrder();
    const lastId = order[order.length - 1];
    const w = await write('write_move_category_group', {
      group_id: lastId,
      before_group_id: order[0],
    });
    expect((await groupOrder())[0]).toBe(lastId);
    await write('write_undo', { write_id: w.write_id });
    expect(await groupOrder()).toEqual(order);
  });

  it('needs structure:write', async () => {
    await setup({ scopes: ['budget:read', 'budget:write'] as Scope[] });
    const x = await group('X', ['A', 'B']);
    const y = await group('Y');
    await plantMove(
      'm1',
      'write_move_category',
      [x.A],
      [
        { id: x.A, field: 'group_id', before: y.id, after: x.id },
        { id: x.A, field: 'next_category_id', before: null, after: x.B },
      ],
    );
    await expectRefusedUndo('m1', /needs structure:write/);
  });

  it('counts one row against the row limit', async () => {
    await setup();
    const x = await group('X', ['A', 'B']);
    const w = await write('write_move_category', {
      category_id: x.A,
      group_id: x.id,
    });
    live.max_rows = 0;
    await expectRefusedUndo(w.write_id, /At most 0 rows/);
  });
});

describe('Undo of a move refuses on any conflict', () => {
  it('the old neighbour is gone: says why and what to do', async () => {
    await setup();
    const x = await group('X', ['A', 'B', 'C']);
    const y = await group('Y');
    const w = await write('write_move_category', {
      category_id: x.B,
      group_id: y.id,
    });
    await api.deleteCategory(x.C);
    const text = await expectRefusedUndo(w.write_id, FIX_CATEGORY);
    expect(text).toContain(`${x.C} (next_category_id)`);
    expect(text).toMatch(/the category it sat before has been deleted/);
    expect(await names(y.id)).toEqual(['B']);
  });

  it('the row or the old group is gone', async () => {
    await setup();
    const x = await group('X', ['B']);
    const y = await group('Y');
    const w = await write('write_move_category', {
      category_id: x.B,
      group_id: y.id,
    });
    await api.deleteCategoryGroup(x.id);
    const text = await expectRefusedUndo(w.write_id, FIX_CATEGORY);
    expect(text).toContain(`${x.id} (group_id)`);
    expect(text).toMatch(/the group it came from has been deleted/);
    await api.deleteCategory(x.B);
    expect(await expectRefusedUndo(w.write_id, /has been deleted/)).toContain(
      `${x.B} (row)`,
    );
  });

  it('moved again since; a retry after the fix works', async () => {
    await setup();
    const x = await group('X', ['A', 'B', 'C']);
    const y = await group('Y');
    const z = await group('Z');
    const w = await write('write_move_category', {
      category_id: x.B,
      group_id: y.id,
    });
    await write('write_move_category', { category_id: x.B, group_id: z.id });
    const text = await expectRefusedUndo(w.write_id, FIX_CATEGORY);
    expect(text).toContain(`${x.B} (group_id)`);
    await write('write_move_category', { category_id: x.B, group_id: y.id });
    await write('write_undo', { write_id: w.write_id });
    expect(await names(x.id)).toEqual(['A', 'B', 'C']);
  });

  it('a name clash in the old group', async () => {
    await setup();
    const x = await group('X', ['A', 'B']);
    const y = await group('Y');
    const w = await write('write_move_category', {
      category_id: x.B,
      group_id: y.id,
    });
    await api.createCategory({ name: 'b', group_id: x.id } satisfies Parameters<
      typeof api.createCategory
    >[0]);
    expect(await expectRefusedUndo(w.write_id, /same name/)).toContain(
      `${x.B} (name)`,
    );
  });

  it('syncs first and sees a change from another device', async () => {
    const sync = await setup();
    const x = await group('X', ['B']);
    const y = await group('Y', ['D']);
    const w = await write('write_move_category', {
      category_id: x.B,
      group_id: y.id,
    });
    // The other device moved B within Y; it arrives with the sync
    sync.mockImplementation(async () => {
      await api.moveCategory(x.B, y.id, y.D);
    });
    const res = await undo(w.write_id);
    expect(sync).toHaveBeenCalled();
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/reordered since/);
    expect(res.text).toContain(`${x.B} (next_category_id)`);
    // Only the other device's change landed
    expect(await names(y.id)).toEqual(['B', 'D']);
    expect(await names(x.id)).toEqual([]);
  });

  it('a group conflict names write_move_category_group', async () => {
    await setup();
    await group('X');
    await group('Z');
    const order = await groupOrder();
    const lastId = order[order.length - 1];
    const w = await write('write_move_category_group', {
      group_id: lastId,
      before_group_id: order[0],
    });
    await api.moveCategoryGroup(lastId, order[1]);
    expect(
      await expectRefusedUndo(
        w.write_id,
        /stays where it is; move it by hand with write_move_category_group, or tell the budget's owner/,
      ),
    ).toContain(`${lastId} (next_group_id)`);
  });
});

describe("Undo of a move applies the move's own rules", () => {
  it('an edited line pointing at an income group', async () => {
    await setup();
    const x = await group('X', ['A']);
    const income = (await api.getCategoryGroups()).find(g => g.is_income)!;
    await plantMove(
      'edited',
      'write_move_category',
      [x.A],
      [
        { id: x.A, field: 'group_id', before: income.id, after: x.id },
        { id: x.A, field: 'next_category_id', before: null, after: null },
      ],
    );
    await expectRefusedUndo('edited', /between an income and an expense group/);
  });

  it('an old next sibling that is the row itself', async () => {
    await setup();
    const x = await group('X', ['A']);
    await plantMove(
      'self',
      'write_move_category',
      [x.A],
      [
        { id: x.A, field: 'group_id', before: x.id, after: x.id },
        { id: x.A, field: 'next_category_id', before: x.A, after: null },
      ],
    );
    await expectRefusedUndo('self', /cannot sit before itself/);
  });
});

describe('Undo of a move reads only a well-formed line', () => {
  it.each([
    ['two next changes', 2, false, 'A'],
    ['a change for another row', 1, true, 'A'],
    ['a value that is not an id', 1, false, 42],
  ])('%s', async (_, nexts, other, next) => {
    await setup();
    const x = await group('X', ['A', 'B']);
    const row = x.A;
    const nextBefore = next === 'A' ? null : next;
    await plantMove(
      'bad',
      'write_move_category',
      [row],
      [
        { id: other ? x.B : row, field: 'group_id', before: x.id, after: x.id },
        ...Array.from({ length: nexts }, () => ({
          id: row,
          field: 'next_category_id',
          before: nextBefore,
          after: null,
        })),
      ],
    );
    await expectRefusedUndo('bad', /not an id of its kind/);
  });

  it('an old schema 2 move line without the new field', async () => {
    await setup();
    const x = await group('X', ['A']);
    await plantMove(
      'old',
      'write_move_category',
      [x.A],
      [
        { id: x.A, field: 'group_id', before: x.id, after: x.id },
        { id: x.A, field: 'before_category_id', before: null, after: null },
      ],
    );
    const reason = /logged before moves recorded their place/;
    const item = (await h.call('list_writes')).json.writes.find(
      (w: { write_id: string }) => w.write_id === 'old',
    );
    expect(item.undoable).toBe(false);
    expect(item.reason).toMatch(reason);
    await expectRefusedUndo('old', reason);
  });
});

describe('Undo of a move: order, atomicity and shape (Tester review)', () => {
  it('undoes a group moved from the middle', async () => {
    await setup();
    await group('X');
    await group('Y');
    const order = await groupOrder();
    const middle = order[1];
    const w = await write('write_move_category_group', { group_id: middle });
    expect(await groupOrder()).not.toEqual(order);
    await write('write_undo', { write_id: w.write_id });
    expect(await groupOrder()).toEqual(order);
  });

  it('puts a group back before the income group, in the engine order', async () => {
    await setup();
    const x = await group('X');
    const z = await group('Z');
    const income = (await api.getCategoryGroups()).find(g => g.is_income)!;
    // Sort order: ..., X, Income, ..., Z; the app lists income last, so X's
    // listed next is not the income group
    await api.moveCategoryGroup(z.id, undefined);
    await api.moveCategoryGroup(x.id, income.id);
    const order = await groupOrder();
    const w = await write('write_move_category_group', { group_id: x.id });
    expect(changesOf(w.write_id)).toEqual([
      { id: x.id, field: 'next_group_id', before: income.id, after: null },
    ]);
    await write('write_undo', { write_id: w.write_id });
    expect(await groupOrder()).toEqual(order);
  });

  it('makes one engine call: a failure changes nothing and the undo stays usable', async () => {
    await setup();
    const x = await group('X', ['A', 'B', 'C']);
    const y = await group('Y');
    const w = await write('write_move_category', {
      category_id: x.B,
      group_id: y.id,
    });
    const before = JSON.stringify(await api.getCategoryGroups());
    const move = vi
      .spyOn(api, 'moveCategory')
      .mockRejectedValueOnce(new Error('boom'));
    const update = vi.spyOn(api, 'updateCategory');
    const failed = await undo(w.write_id);
    expect(failed.json.failure).toMatch(/before any row changed/);
    expect(move).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    expect(JSON.stringify(await api.getCategoryGroups())).toBe(before);
    await write('write_undo', { write_id: w.write_id });
    expect(await names(x.id)).toEqual(['A', 'B', 'C']);
  });

  it('refuses when the old next sibling is now in another group', async () => {
    await setup();
    const x = await group('X', ['A', 'B', 'C']);
    const y = await group('Y');
    const z = await group('Z');
    const w = await write('write_move_category', {
      category_id: x.B,
      group_id: y.id,
    });
    await api.moveCategory(x.C, z.id);
    const text = await expectRefusedUndo(w.write_id, FIX_CATEGORY);
    expect(text).toContain(`${x.C} (next_category_id)`);
    expect(text).toMatch(/the category it sat before is now in another group/);
  });

  it.each([
    ['a group line with two ids', 'write_move_category_group', true, false],
    [
      'a group line with an extra change',
      'write_move_category_group',
      false,
      true,
    ],
    [
      'a category line without its group_id change',
      'write_move_category',
      false,
      false,
    ],
  ])('%s is not undoable', async (_, tool, twoIds, extra) => {
    await setup();
    const x = await group('X', ['A']);
    const y = await group('Y');
    const isCategory = tool === 'write_move_category';
    const row = isCategory ? x.A : x.id;
    const next = isCategory ? 'next_category_id' : 'next_group_id';
    await plantMove('shape', tool, twoIds ? [row, y.id] : [row], [
      { id: row, field: next, before: null, after: null },
      ...(extra
        ? [{ id: row, field: 'group_id', before: y.id, after: x.id }]
        : []),
    ]);
    await expectRefusedUndo('shape', /not an id of its kind/);
  });
});
