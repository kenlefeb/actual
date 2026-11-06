import * as api from '@actual-app/api';
import { z } from 'zod';

import { Refusal } from '#refusal';
import { withText } from '#sanitize';
import type { RegisterTool } from '#tools/read/shared';

import type { WriteLog } from './shared';
import { id, loggedWrite, MAX_WRITE_ROWS } from './shared';

type Cat = { id: string; name: string; is_income: boolean; hidden: boolean };
type Group = Cat & { categories: Cat[] };

const MAX_NAME = 100;
const NOTHING = 'Nothing changed.';

/** Every group (hidden ones too) with its categories, in the budget's order. */
async function load(): Promise<Group[]> {
  return (await api.getCategoryGroups()).map(g => ({
    id: g.id,
    name: g.name,
    is_income: Boolean(g.is_income),
    hidden: Boolean(g.hidden),
    categories: (g.categories ?? []).map(c => ({
      id: c.id,
      name: c.name,
      is_income: Boolean(c.is_income),
      hidden: Boolean(c.hidden),
    })),
  }));
}

function findGroup(groups: Group[], groupId: string, what = 'group_id') {
  const found = groups.find(g => g.id === groupId);
  if (!found) {
    throw new Refusal(
      `${what} must be the id of an existing category group, never a name. ${NOTHING}`,
    );
  }
  return found;
}

function findCategory(
  groups: Group[],
  categoryId: string,
  what = 'category_id',
) {
  for (const group of groups) {
    const category = group.categories.find(c => c.id === categoryId);
    if (category) return { group, category };
  }
  throw new Refusal(
    `${what} must be the id of an existing category, never a name. ${NOTHING}`,
  );
}

/** Trims a name and refuses an empty, over-long or duplicate one (fixed text). */
function requireName(
  raw: string,
  others: Array<{ id: string; name: string }>,
  self?: string,
  what = 'category',
) {
  const name = raw.trim();
  if (!name || name.length > MAX_NAME) {
    throw new Refusal(`name must be 1 to ${MAX_NAME} characters. ${NOTHING}`);
  }
  if (
    others.some(
      o => o.id !== self && o.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    throw new Refusal(
      `A ${what} with that name already exists${what === 'category' ? ' in the group' : ''}. ${NOTHING}`,
    );
  }
  return name;
}

function requireChange(fields: { name?: string; hidden?: boolean }) {
  if (fields.name === undefined && fields.hidden === undefined) {
    throw new Refusal(`Give a name or hidden to change. ${NOTHING}`);
  }
}

type Usage = { transactions: number; months: string[] };

function usageText(u: Usage) {
  const months = u.months.slice(0, 24).join(', ');
  const more = u.months.length > 24 ? ` and ${u.months.length - 24} more` : '';
  return `${u.transactions} transaction${u.transactions === 1 ? '' : 's'}, budgeted months: ${months || 'none'}${more}`;
}

const inUse = (u: Usage) => u.transactions > 0 || u.months.length > 0;

/** The change of one field, or nothing when it did not change. */
function diff<T>(before: T, after: T) {
  return before === after ? {} : { before, after };
}

export function registerCategoryWriteTools(
  tool: RegisterTool,
  auditLog: WriteLog,
) {
  tool(
    'write_create_category_group',
    'Create an expense category group by name (income groups cannot be created). Returns the new group id.',
    { name: z.string() },
    async ({ name: raw }) => {
      const groups = await load();
      const name = requireName(raw, groups, undefined, 'group');
      let created = '';
      return loggedWrite(
        auditLog,
        'write_create_category_group',
        {
          ids: [],
          changes: [{ id: 'new', field: 'name', before: null, after: name }],
        },
        async () => {
          created = await api.createCategoryGroup({ name } as never);
          return { applied: [created], created: [created] };
        },
        async () => withText({ group_id: created }, { name }),
      );
    },
  );

  tool(
    'write_create_category',
    'Create a category in a category group, by group id (never a name). It is income or expense as its group is. Returns the new category id.',
    { name: z.string(), group_id: id },
    async ({ name: raw, group_id }) => {
      const groups = await load();
      const group = findGroup(groups, group_id);
      const name = requireName(raw, group.categories);
      let created = '';
      return loggedWrite(
        auditLog,
        'write_create_category',
        {
          ids: [group_id],
          changes: [
            { id: 'new', field: 'name', before: null, after: name },
            { id: 'new', field: 'group_id', before: null, after: group_id },
          ],
        },
        async () => {
          created = await api.createCategory({
            name,
            group_id,
            is_income: group.is_income,
          } as never);
          return { applied: [created], created: [created] };
        },
        async () =>
          withText(
            { category_id: created, group_id, is_income: group.is_income },
            { name },
          ),
      );
    },
  );

  tool(
    'write_update_category_group',
    'Rename and/or hide or unhide a category group, by group id (never a name). Give name, hidden or both. Returns each changed field before and after.',
    {
      group_id: id,
      name: z.string().optional(),
      hidden: z.boolean().optional(),
    },
    async ({ group_id, name: raw, hidden }) => {
      requireChange({ name: raw, hidden });
      const groups = await load();
      const group = findGroup(groups, group_id);
      const name =
        raw === undefined
          ? undefined
          : requireName(raw, groups, group_id, 'group');
      const changes = [
        ...(name !== undefined
          ? [{ id: group_id, field: 'name', before: group.name, after: name }]
          : []),
        ...(hidden !== undefined
          ? [
              {
                id: group_id,
                field: 'hidden',
                before: group.hidden,
                after: hidden,
              },
            ]
          : []),
      ];
      return loggedWrite(
        auditLog,
        'write_update_category_group',
        { ids: [group_id], changes },
        async () => {
          await api.updateCategoryGroup(group_id, {
            ...(name !== undefined ? { name } : {}),
            ...(hidden !== undefined ? { hidden } : {}),
          });
          return { applied: [group_id] };
        },
        async () => {
          const after = findGroup(await load(), group_id);
          return withText(
            { group_id, hidden: diff(group.hidden, after.hidden) },
            { name: diff(group.name, after.name) },
          );
        },
      );
    },
  );

  tool(
    'write_update_category',
    'Rename and/or hide or unhide a category, by category id (never a name). Give name, hidden or both. Returns each changed field before and after.',
    {
      category_id: id,
      name: z.string().optional(),
      hidden: z.boolean().optional(),
    },
    async ({ category_id, name: raw, hidden }) => {
      requireChange({ name: raw, hidden });
      const groups = await load();
      const { group, category } = findCategory(groups, category_id);
      const name =
        raw === undefined
          ? undefined
          : requireName(raw, group.categories, category_id);
      const changes = [
        ...(name !== undefined
          ? [
              {
                id: category_id,
                field: 'name',
                before: category.name,
                after: name,
              },
            ]
          : []),
        ...(hidden !== undefined
          ? [
              {
                id: category_id,
                field: 'hidden',
                before: category.hidden,
                after: hidden,
              },
            ]
          : []),
      ];
      return loggedWrite(
        auditLog,
        'write_update_category',
        { ids: [category_id], changes },
        async () => {
          await api.updateCategory(category_id, {
            ...(name !== undefined ? { name } : {}),
            ...(hidden !== undefined ? { hidden } : {}),
          });
          return { applied: [category_id] };
        },
        async () => {
          const after = findCategory(await load(), category_id).category;
          return withText(
            { category_id, hidden: diff(category.hidden, after.hidden) },
            { name: diff(category.name, after.name) },
          );
        },
      );
    },
  );

  tool(
    'write_move_category',
    'Move a category into a group (the same group to reorder), before another category of that group, or last when before_category_id is omitted. All ids, never names. A category stays income or expense: it cannot move between an income and an expense group. Returns its group and position before and after.',
    {
      category_id: id,
      group_id: id,
      before_category_id: id.optional(),
    },
    async ({ category_id, group_id, before_category_id }) => {
      const groups = await load();
      const { group: from, category } = findCategory(groups, category_id);
      const to = findGroup(groups, group_id);
      if (to.is_income !== category.is_income) {
        throw new Refusal(
          `A category cannot move between an income and an expense group. ${NOTHING}`,
        );
      }
      if (before_category_id !== undefined) {
        if (
          before_category_id === category_id ||
          !to.categories.some(c => c.id === before_category_id)
        ) {
          throw new Refusal(
            `before_category_id must be the id of another category in the target group. ${NOTHING}`,
          );
        }
      }
      if (from.id !== to.id) {
        requireName(category.name, to.categories, category_id);
      }
      const before = {
        group_id: from.id,
        position: from.categories.findIndex(c => c.id === category_id),
      };
      return loggedWrite(
        auditLog,
        'write_move_category',
        {
          ids: [category_id],
          changes: [
            {
              id: category_id,
              field: 'group_id',
              before: before.group_id,
              after: group_id,
            },
            {
              id: category_id,
              field: 'before_category_id',
              before: null,
              after: before_category_id ?? null,
            },
          ],
        },
        async () => {
          await api.moveCategory(category_id, group_id, before_category_id);
          return { applied: [category_id] };
        },
        async () => {
          const found = findCategory(await load(), category_id);
          return {
            category_id,
            group_id: { before: before.group_id, after: found.group.id },
            position: {
              before: before.position,
              after: found.group.categories.findIndex(
                c => c.id === category_id,
              ),
            },
          };
        },
      );
    },
  );

  tool(
    'write_move_category_group',
    'Move a category group before another group, or last when before_group_id is omitted. Ids, never names. Returns its position before and after.',
    { group_id: id, before_group_id: id.optional() },
    async ({ group_id, before_group_id }) => {
      const groups = await load();
      findGroup(groups, group_id);
      if (before_group_id !== undefined) {
        findGroup(groups, before_group_id, 'before_group_id');
        if (before_group_id === group_id) {
          throw new Refusal(
            `before_group_id must be the id of another group. ${NOTHING}`,
          );
        }
      }
      const before = groups.findIndex(g => g.id === group_id);
      return loggedWrite(
        auditLog,
        'write_move_category_group',
        {
          ids: [group_id],
          changes: [
            {
              id: group_id,
              field: 'before_group_id',
              before: null,
              after: before_group_id ?? null,
            },
          ],
        },
        async () => {
          await api.moveCategoryGroup(group_id, before_group_id);
          return { applied: [group_id] };
        },
        async () => ({
          group_id,
          position: {
            before,
            after: (await load()).findIndex(g => g.id === group_id),
          },
        }),
      );
    },
  );

  tool(
    'write_delete_category',
    'Delete a category, by category id (never a name). When it has transactions or budgeted amounts, transfer_category_id (another category of the same kind) is required and receives them; without it the call is refused with the counts. There is no dry run and no undo.',
    { category_id: id, transfer_category_id: id.optional() },
    async ({ category_id, transfer_category_id }) => {
      const groups = await load();
      const { category } = findCategory(groups, category_id);
      if (transfer_category_id !== undefined) {
        const target = findCategory(
          groups,
          transfer_category_id,
          'transfer_category_id',
        ).category;
        if (target.id === category_id) {
          throw new Refusal(
            `transfer_category_id must be a different category. ${NOTHING}`,
          );
        }
        if (target.is_income !== category.is_income) {
          throw new Refusal(
            `The transfer category must be income or expense like the deleted one. ${NOTHING}`,
          );
        }
      }
      const usage = await api.getCategoryUsage(category_id);
      if (inUse(usage) && transfer_category_id === undefined) {
        throw new Refusal(
          `The category is in use (${usageText(usage)}). Pass transfer_category_id to move them. ${NOTHING}`,
        );
      }
      return loggedWrite(
        auditLog,
        'write_delete_category',
        {
          ids: [category_id],
          changes: [
            {
              id: category_id,
              field: 'name',
              before: category.name,
              after: null,
            },
            {
              id: category_id,
              field: 'transfer_category_id',
              before: null,
              after: transfer_category_id ?? null,
            },
          ],
        },
        async () => {
          await api.deleteCategory(category_id, transfer_category_id);
          return { applied: [category_id] };
        },
        async () =>
          withText(
            {
              category_id,
              deleted: true,
              transfer_category_id: transfer_category_id ?? null,
              moved_transactions: transfer_category_id ? usage.transactions : 0,
              moved_months: transfer_category_id ? usage.months : [],
            },
            { name: category.name },
          ),
      );
    },
  );

  tool(
    'write_delete_category_group',
    `Delete an expense category group and its categories (hidden ones too), by group id (never a name). When any category has transactions or budgeted amounts, transfer_category_id (an expense category outside the group) is required and receives them all; without it the call is refused naming the categories in use. At most ${MAX_WRITE_ROWS} categories. There is no dry run and no undo.`,
    { group_id: id, transfer_category_id: id.optional() },
    async ({ group_id, transfer_category_id }) => {
      const groups = await load();
      const group = findGroup(groups, group_id);
      if (group.is_income) {
        throw new Refusal(`The income group cannot be deleted. ${NOTHING}`);
      }
      if (group.categories.length > MAX_WRITE_ROWS) {
        throw new Refusal(
          `A group of more than ${MAX_WRITE_ROWS} categories cannot be deleted in one call. Move or delete some first. ${NOTHING}`,
        );
      }
      if (transfer_category_id !== undefined) {
        const target = findCategory(
          groups,
          transfer_category_id,
          'transfer_category_id',
        );
        if (target.group.id === group_id) {
          throw new Refusal(
            `transfer_category_id must be outside the group being deleted. ${NOTHING}`,
          );
        }
        if (target.category.is_income) {
          throw new Refusal(
            `transfer_category_id must be an expense category. ${NOTHING}`,
          );
        }
      }
      const used: string[] = [];
      let moved = 0;
      for (const c of group.categories) {
        const usage = await api.getCategoryUsage(c.id);
        if (inUse(usage)) {
          used.push(`${c.id}: ${usageText(usage)}`);
          moved += usage.transactions;
        }
      }
      if (used.length > 0 && transfer_category_id === undefined) {
        throw new Refusal(
          `These categories are in use: ${used.join('; ')}. Pass transfer_category_id to move them. ${NOTHING}`,
        );
      }
      return loggedWrite(
        auditLog,
        'write_delete_category_group',
        {
          ids: [group_id, ...group.categories.map(c => c.id)],
          changes: [
            { id: group_id, field: 'name', before: group.name, after: null },
            ...group.categories.map(c => ({
              id: c.id,
              field: 'name',
              before: c.name,
              after: null,
            })),
            {
              id: group_id,
              field: 'transfer_category_id',
              before: null,
              after: transfer_category_id ?? null,
            },
          ],
        },
        async () => {
          await api.deleteCategoryGroup(group_id, transfer_category_id);
          return { applied: [group_id, ...group.categories.map(c => c.id)] };
        },
        async () =>
          withText(
            {
              group_id,
              deleted: true,
              category_ids: group.categories.map(c => c.id),
              transfer_category_id: transfer_category_id ?? null,
              moved_transactions: transfer_category_id ? moved : 0,
            },
            { name: group.name },
          ),
      );
    },
  );
}
