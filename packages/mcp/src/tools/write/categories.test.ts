import { existsSync, readFileSync } from 'fs';

import * as api from '@actual-app/api';

import { startHarness } from '#client-harness';

let h: Awaited<ReturnType<typeof startHarness>>;

beforeEach(async () => {
  h = await startHarness({ count: 3 }, { writes: true });
});

afterEach(async () => {
  await h.close();
});

function auditLines() {
  if (!existsSync(h.auditLog)) return [];
  return readFileSync(h.auditLog, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

async function groups() {
  return api.getCategoryGroups();
}

async function group(name: string) {
  return (await groups()).find(g => g.name === name)!;
}

async function layout() {
  return (await groups()).map(g => ({
    name: g.name,
    categories: (g.categories ?? []).map(c => c.name),
  }));
}

async function newGroup(name: string) {
  return api.createCategoryGroup({ name });
}

async function newCategory(name: string, groupId: string) {
  return api.createCategory({ name, group_id: groupId } as never);
}

async function refused(
  tool: string,
  args: Record<string, unknown>,
  text?: RegExp,
) {
  const before = JSON.stringify(await groups());
  const logged = auditLines().length;
  const res = await h.call(tool, args);
  expect(res.isError).toBe(true);
  if (text) expect(res.text).toMatch(text);
  expect(JSON.stringify(await groups())).toBe(before);
  expect(auditLines().length).toBe(logged);
}

const WRITE_TOOLS = [
  'write_create_category_group',
  'write_create_category',
  'write_update_category_group',
  'write_update_category',
  'write_move_category',
  'write_move_category_group',
  'write_delete_category',
  'write_delete_category_group',
];

describe('category maintenance tools', () => {
  it('Lists the eight tools', async () => {
    const names = (await h.client.listTools()).tools.map(t => t.name);
    expect(names).toEqual(expect.arrayContaining(WRITE_TOOLS));
  });

  it('Create a group and a category', async () => {
    const g = await h.call('write_create_category_group', { name: 'Pets' });
    expect(g.isError).toBe(false);
    const groupId = g.json.group_id;
    const c = await h.call('write_create_category', {
      name: 'Vet',
      group_id: groupId,
    });
    expect(c.isError).toBe(false);

    const listed = await h.call('list_category_groups');
    const pets = listed.json.items.find(
      (x: { id: string }) => x.id === groupId,
    );
    expect(pets.text.name).toBe('Pets');
    expect(pets.categories).toEqual([
      expect.objectContaining({
        id: c.json.category_id,
        is_income: false,
        hidden: false,
      }),
    ]);
    expect(auditLines().map(l => l.phase)).toEqual([
      'attempt',
      'outcome',
      'attempt',
      'outcome',
    ]);
    expect(auditLines()[3].created).toEqual([c.json.category_id]);
  });

  it('A category in the income group is income', async () => {
    const income = (await groups()).find(g => g.is_income)!;
    const c = await h.call('write_create_category', {
      name: 'Bonus',
      group_id: income.id,
    });
    expect(c.isError).toBe(false);
    const made = (await api.getCategories()).find(
      x => x.id === c.json.category_id,
    );
    expect(made?.is_income).toBe(true);
  });

  it('Rename, hide and unhide', async () => {
    const pets = await newGroup('Pets');
    const vet = await newCategory('Vet', pets);

    const renamed = await h.call('write_update_category', {
      category_id: vet,
      name: 'Veterinarian',
      hidden: true,
    });
    expect(renamed.json.text.name).toEqual({
      before: 'Vet',
      after: 'Veterinarian',
    });
    expect(renamed.json.hidden).toEqual({ before: false, after: true });
    let cat = (await api.getCategories()).find(c => c.id === vet);
    expect(cat).toMatchObject({ name: 'Veterinarian', hidden: true });

    const shown = await h.call('write_update_category', {
      category_id: vet,
      hidden: false,
    });
    expect(shown.json.hidden).toEqual({ before: true, after: false });
    cat = (await api.getCategories()).find(c => c.id === vet);
    expect(cat?.hidden).toBe(false);
    expect(cat?.name).toBe('Veterinarian');

    const g = await h.call('write_update_category_group', {
      group_id: pets,
      name: 'Animals',
      hidden: true,
    });
    expect(g.json.text.name).toEqual({ before: 'Pets', after: 'Animals' });
    expect(await group('Animals')).toMatchObject({ hidden: true });
    await h.call('write_update_category_group', {
      group_id: pets,
      hidden: false,
    });
    expect(await group('Animals')).toMatchObject({ hidden: false });

    const attempt = auditLines().find(
      l => l.phase === 'attempt' && l.tool === 'write_update_category',
    );
    expect(attempt.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: vet,
          field: 'name',
          before: 'Vet',
          after: 'Veterinarian',
        }),
      ]),
    );
  });

  it('An update needs a change', async () => {
    const pets = await newGroup('Pets');
    await refused('write_update_category_group', { group_id: pets });
    expect(auditLines()).toEqual([]);
  });

  it('Move and reorder', async () => {
    const x = await newGroup('X');
    const y = await newGroup('Y');
    // New categories are listed first, so this makes "A", "B" in that order
    await newCategory('B', x);
    const a = await newCategory('A', x);
    const c = await newCategory('C', y);

    const moved = await h.call('write_move_category', {
      category_id: c,
      group_id: x,
      before_category_id: a,
    });
    expect(moved.isError).toBe(false);
    expect(moved.json.group_id).toEqual({ before: y, after: x });
    expect(moved.json.position).toEqual({ before: 0, after: 0 });

    const gm = await h.call('write_move_category_group', {
      group_id: y,
      before_group_id: x,
    });
    expect(gm.isError).toBe(false);

    const all = await layout();
    const names = all.map(g => g.name);
    expect(names.indexOf('Y')).toBe(names.indexOf('X') - 1);
    expect(all.find(g => g.name === 'X')?.categories).toEqual(['C', 'A', 'B']);

    // Last place, same group
    await h.call('write_move_category', { category_id: c, group_id: x });
    expect((await layout()).find(g => g.name === 'X')?.categories).toEqual([
      'A',
      'B',
      'C',
    ]);
    expect(
      auditLines().filter(l => l.tool === 'write_move_category'),
    ).toHaveLength(4);
  });

  it('A duplicate name', async () => {
    const food = await newGroup('Food');
    const other = await newGroup('Other');
    const dining = await newCategory('Dining', food);
    const snacks = await newCategory('Snacks', food);
    const dup = await newCategory('dining', other);

    await refused(
      'write_create_category',
      { name: 'dining', group_id: food },
      /exists/,
    );
    await refused(
      'write_update_category',
      { category_id: snacks, name: 'DINING' },
      /exists/,
    );
    await refused('write_create_category_group', { name: 'food' }, /exists/);
    await refused(
      'write_update_category_group',
      { group_id: other, name: 'FOOD' },
      /exists/,
    );
    await refused(
      'write_move_category',
      { category_id: dup, group_id: food },
      /exists/,
    );
    // Renaming to its own name with other case is fine
    const ok = await h.call('write_update_category', {
      category_id: dining,
      name: 'DINING',
    });
    expect(ok.isError).toBe(false);
  });

  it('Bad names', async () => {
    const pets = await newGroup('Pets');
    await refused('write_create_category_group', { name: '   ' });
    await refused('write_create_category_group', { name: 'x'.repeat(101) });
    await refused('write_create_category', { name: '', group_id: pets });
    expect(auditLines()).toEqual([]);
  });

  it('An unknown id or a name', async () => {
    const pets = await newGroup('Pets');
    const vet = await newCategory('Vet', pets);
    await refused('write_update_category', { category_id: 'nope', name: 'x' });
    await refused('write_update_category', { category_id: 'Vet', name: 'x' });
    await refused('write_create_category', { name: 'x', group_id: 'Pets' });
    await refused('write_move_category', {
      category_id: vet,
      group_id: 'Pets',
    });
    await refused('write_move_category', {
      category_id: vet,
      group_id: pets,
      before_category_id: 'nope',
    });
    await refused('write_move_category_group', {
      group_id: pets,
      before_group_id: 'nope',
    });
    await refused('write_delete_category', { category_id: 'Vet' });
    await refused('write_delete_category_group', { group_id: 'Pets' });
    await refused('write_delete_category', {
      category_id: vet,
      transfer_category_id: 'nope',
    });
    expect(auditLines()).toEqual([]);
  });

  it('Income and expense are not mixed', async () => {
    const income = (await groups()).find(g => g.is_income)!;
    const pets = await newGroup('Pets');
    const vet = await newCategory('Vet', pets);
    const salary = income.categories![0];

    await refused(
      'write_move_category',
      { category_id: vet, group_id: income.id },
      /income/,
    );
    await refused(
      'write_move_category',
      { category_id: salary.id, group_id: pets },
      /income/,
    );
    expect(auditLines()).toEqual([]);
  });
});

describe('category delete', () => {
  async function dining() {
    const food = await newGroup('Food');
    const diningId = await newCategory('Dining', food);
    const groceries = await newCategory('Groceries', await newGroup('Home'));
    await api.addTransactions(h.fixture.accountId, [
      { date: '2026-02-01', amount: -500, category: diningId },
      { date: '2026-02-02', amount: -700, category: diningId },
    ]);
    await api.setBudgetAmount('2026-02', diningId, 9000);
    await api.setBudgetAmount('2026-03', diningId, 1000);
    await api.setBudgetAmount('2026-02', groceries, 2000);
    return { food, diningId, groceries };
  }

  async function count(category: string) {
    const { data } = (await api.runQuery(
      api.q('transactions').filter({ category }).calculate({ $count: '$id' }),
    )) as { data: number };
    return data;
  }

  async function budgeted(m: string, id: string) {
    const { categoryGroups } = await api.getBudgetMonth(m);
    return categoryGroups
      .flatMap(g => g.categories ?? [])
      .find(c => c.id === id)?.budgeted;
  }

  it('In use, no transfer', async () => {
    const { diningId } = await dining();
    await refused(
      'write_delete_category',
      { category_id: diningId },
      /2 transactions[\s\S]*2026-02[\s\S]*2026-03/,
    );
    expect(await count(diningId)).toBe(2);
  });

  it('In use, with a transfer', async () => {
    const { diningId, groceries } = await dining();
    const res = await h.call('write_delete_category', {
      category_id: diningId,
      transfer_category_id: groceries,
    });
    expect(res.isError).toBe(false);
    expect((await api.getCategories()).some(c => c.id === diningId)).toBe(
      false,
    );
    expect(await count(groceries)).toBe(2);
    expect(await budgeted('2026-02', groceries)).toBe(11000);
    expect(await budgeted('2026-03', groceries)).toBe(1000);
    const lines = auditLines();
    expect(lines).toHaveLength(2);
    expect(JSON.stringify(lines[0].changes)).toContain(groceries);
  });

  it('Not in use', async () => {
    const pets = await newGroup('Pets');
    const vet = await newCategory('Vet', pets);
    const res = await h.call('write_delete_category', { category_id: vet });
    expect(res.isError).toBe(false);
    expect((await api.getCategories()).some(c => c.id === vet)).toBe(false);
  });

  it('A bad transfer', async () => {
    const { diningId, groceries } = await dining();
    const income = (await groups()).find(g => g.is_income)!;
    await refused(
      'write_delete_category',
      { category_id: diningId, transfer_category_id: income.categories![0].id },
      /income|expense/,
    );
    await refused('write_delete_category', {
      category_id: groceries,
      transfer_category_id: groceries,
    });
    expect(auditLines()).toEqual([]);
  });
});

describe('category group delete', () => {
  async function food() {
    const foodId = await newGroup('Food');
    const dining = await newCategory('Dining', foodId);
    const snacks = await newCategory('Snacks', foodId);
    const groceries = await newCategory('Groceries', await newGroup('Home'));
    await api.addTransactions(h.fixture.accountId, [
      { date: '2026-02-01', amount: -500, category: dining },
    ]);
    await api.setBudgetAmount('2026-02', dining, 9000);
    return { foodId, dining, snacks, groceries };
  }

  it('A group in use, no transfer', async () => {
    const { foodId, dining } = await food();
    await refused(
      'write_delete_category_group',
      { group_id: foodId },
      /1 transaction/,
    );
    expect((await api.getCategories()).some(c => c.id === dining)).toBe(true);
  });

  it('A group in use, with a transfer', async () => {
    const { foodId, dining, snacks, groceries } = await food();
    const res = await h.call('write_delete_category_group', {
      group_id: foodId,
      transfer_category_id: groceries,
    });
    expect(res.isError).toBe(false);
    const ids = (await api.getCategories()).map(c => c.id);
    expect(ids).not.toContain(dining);
    expect(ids).not.toContain(snacks);
    expect((await groups()).some(g => g.id === foodId)).toBe(false);
    const { data } = (await api.runQuery(
      api
        .q('transactions')
        .filter({ category: groceries })
        .calculate({ $count: '$id' }),
    )) as { data: number };
    expect(data).toBe(1);
    const lines = auditLines();
    expect(lines).toHaveLength(2);
    expect(lines[0].ids).toEqual(
      expect.arrayContaining([foodId, dining, snacks]),
    );
    expect(JSON.stringify(lines[0].changes)).toContain(groceries);
  });

  it('A transfer inside the group, or not an expense category', async () => {
    const { foodId, snacks } = await food();
    await refused('write_delete_category_group', {
      group_id: foodId,
      transfer_category_id: snacks,
    });
    const income = (await groups()).find(g => g.is_income)!;
    await refused('write_delete_category_group', {
      group_id: foodId,
      transfer_category_id: income.categories![0].id,
    });
    expect(auditLines()).toEqual([]);
  });

  it('The income group', async () => {
    const income = (await groups()).find(g => g.is_income)!;
    await refused('write_delete_category_group', { group_id: income.id });
    expect(auditLines()).toEqual([]);
  });

  it('A group of unused categories', async () => {
    const pets = await newGroup('Pets');
    await newCategory('Vet', pets);
    await newCategory('Food', pets);
    const res = await h.call('write_delete_category_group', {
      group_id: pets,
    });
    expect(res.isError).toBe(false);
    expect((await groups()).some(g => g.id === pets)).toBe(false);
    expect((await api.getCategories()).some(c => c.name === 'Vet')).toBe(false);
  });

  it('A hidden category counts', async () => {
    const { foodId, dining, groceries } = await food();
    await api.updateCategory(dining, { hidden: true });
    await refused('write_delete_category_group', { group_id: foodId });
    const res = await h.call('write_delete_category_group', {
      group_id: foodId,
      transfer_category_id: groceries,
    });
    expect(res.isError).toBe(false);
  });

  it('An empty group', async () => {
    const empty = await newGroup('Empty');
    const res = await h.call('write_delete_category_group', {
      group_id: empty,
    });
    expect(res.isError).toBe(false);
    expect((await groups()).some(g => g.id === empty)).toBe(false);
    expect(auditLines()[0].ids).toContain(empty);
  });

  it('Too many categories', async () => {
    const big = await newGroup('Big');
    for (let i = 0; i < 51; i++) await newCategory(`C${i}`, big);
    await refused('write_delete_category_group', { group_id: big }, /50/);
    expect(auditLines()).toEqual([]);
  });
});

describe('category list', () => {
  it('Hidden and income', async () => {
    const pets = await newGroup('Pets');
    const vet = await newCategory('Vet', pets);
    await api.updateCategory(vet, { hidden: true });
    const res = await h.call('list_category_groups');
    const all = res.json.items as Array<{
      is_income: boolean;
      categories: Array<{ id: string; hidden: boolean; is_income: boolean }>;
    }>;
    expect(
      all.flatMap(g => g.categories).find(c => c.id === vet),
    ).toMatchObject({ hidden: true, is_income: false });
    const income = all.find(g => g.is_income)!;
    expect(income.categories.length).toBeGreaterThan(0);
    expect(income.categories.every(c => c.is_income)).toBe(true);
  });
});
