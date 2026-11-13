import * as api from '@actual-app/api';
import { z } from 'zod';

import { buildPage, pageParams } from '#paging';
import { withText } from '#sanitize';

import { pageShape } from './shared';
import type { RegisterTool } from './shared';

export function registerAttachmentTools(tool: RegisterTool) {
  tool(
    'list_transaction_attachments',
    "List the documents (receipts, invoices) attached to a transaction: id, name, type and size in bytes and created time. Metadata only; a document's content is never returned. Empty when the transaction has none.",
    { transaction_id: z.string().min(1).max(100), ...pageShape },
    async ({ transaction_id, ...input }) => {
      const p = pageParams(input);
      // A split line's documents belong to its parent, as in the app
      const { data: own } = (await api.runQuery(
        api
          .q('transactions')
          .filter({ id: transaction_id })
          .select('parent_id'),
      )) as { data: Array<{ parent_id: string | null }> };
      const owner = own[0]?.parent_id ?? transaction_id;
      // Only these columns are selected: no hash or encryption data
      const { data } = (await api.runQuery(
        api
          .q('transaction_attachments')
          .filter({ transaction_id: owner })
          .select([
            'id',
            'transaction_id',
            'name',
            'mime',
            'size',
            'created_at',
          ])
          .orderBy([{ created_at: 'asc' }, 'id'])
          .limit(p.limit + 1)
          .offset(p.offset),
      )) as { data: Array<Record<string, unknown>> };
      return buildPage(
        data.map(a =>
          withText(
            {
              id: a.id,
              transaction_id: a.transaction_id,
              mime: a.mime,
              size: a.size,
              created_at: a.created_at,
            },
            { name: a.name },
          ),
        ),
        p,
      );
    },
  );
}
