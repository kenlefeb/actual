import * as db from '#server/db';
import type { DbSchedule } from '#server/db';

import { GOAL_PREFIX, TEMPLATE_PREFIX } from './template-notes';

// Categories whose automations came from notes that no longer hold a template
const NO_TEMPLATE_NOTE = `
      id NOT IN (SELECT n.id
                 FROM notes n
                 WHERE lower(note) LIKE '%${TEMPLATE_PREFIX}%'
                    OR lower(note) LIKE '%${GOAL_PREFIX}%')
        AND COALESCE(JSON_EXTRACT(template_settings, '$.source'), 'notes') <> 'ui'`;

export async function resetCategoryGoalDefsWithNoTemplates(
  categoryIds?: string[],
): Promise<void> {
  if (categoryIds?.length === 0) return;
  const scopeClause = categoryIds
    ? `AND id IN (${categoryIds.map(() => '?').join(',')})`
    : '';
  await db.run(
    `
      UPDATE categories
      SET goal_def = NULL
      WHERE ${NO_TEMPLATE_NOTE}
        ${scopeClause}
    `,
    categoryIds ?? [],
  );
}

/** The automations `resetCategoryGoalDefsWithNoTemplates` would clear, without clearing them. */
export function getGoalDefsToReset(): Promise<
  Array<{ id: string; goal_def: string }>
> {
  return db.all(
    `SELECT id, goal_def FROM categories WHERE goal_def IS NOT NULL AND ${NO_TEMPLATE_NOTE}`,
  );
}

export type CategoryWithTemplateNote = {
  id: string;
  name: string;
  note: string;
};

export async function getCategoriesWithTemplateNotes(
  categoryIds?: string[],
): Promise<CategoryWithTemplateNote[]> {
  if (categoryIds?.length === 0) return [];
  const scopeClause = categoryIds
    ? `AND c.id IN (${categoryIds.map(() => '?').join(',')})`
    : '';
  return await db.all<
    Pick<db.DbCategory, 'id' | 'name'> & Pick<db.DbNote, 'note'>
  >(
    `
      SELECT c.id AS id, c.name as name, n.note AS note
      FROM notes n
             JOIN categories c ON n.id = c.id
      WHERE c.id = n.id
        AND c.tombstone = 0
        AND COALESCE(JSON_EXTRACT(c.template_settings, '$.source'), 'notes') <> 'ui'
        AND (lower(note) LIKE '%${TEMPLATE_PREFIX}%'
        OR lower(note) LIKE '%${GOAL_PREFIX}%')
        ${scopeClause}
    `,
    categoryIds ?? [],
  );
}

export async function getActiveSchedules() {
  return await db.all<
    Pick<
      DbSchedule,
      | 'id'
      | 'rule'
      | 'active'
      | 'completed'
      | 'posts_transaction'
      | 'tombstone'
      | 'name'
    >
  >(
    'SELECT id, rule, active, completed, posts_transaction, tombstone, name from schedules WHERE name NOT NULL AND tombstone = 0',
  );
}
