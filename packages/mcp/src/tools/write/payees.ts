import * as api from '@actual-app/api';
import { z } from 'zod';

import { Refusal } from '#refusal';
import { withText } from '#sanitize';

import type { RegisterWriteTool } from './shared';
import { loggedWrite } from './shared';

const MAX_NAME = 100;
const NOTHING = 'Nothing changed.';

export function registerPayeeWriteTools(tool: RegisterWriteTool) {
  tool(
    'write_create_payee',
    "Create a payee by name (1 to 100 characters, trimmed), as the app does. A name equal, ignoring case, to a live payee returns that payee's id with created false and writes nothing; a transfer payee's name is refused. `dry_run` says whether it would create one and the existing id, and writes nothing. Returns payee_id, name and created.",
    { name: z.string(), dry_run: z.boolean().optional() },
    async ({ name: raw, dry_run }, auditLog) => {
      const name = raw.trim();
      if (!name || name.length > MAX_NAME) {
        throw new Refusal(
          `name must be 1 to ${MAX_NAME} characters. ${NOTHING}`,
        );
      }
      const existing = (await api.getPayees()).find(
        p => p.name.toLowerCase() === name.toLowerCase(),
      );
      if (existing?.transfer_acct) {
        throw new Refusal(
          `That name belongs to a transfer payee; payees for transfers are made with accounts. ${NOTHING}`,
        );
      }
      if (existing || dry_run) {
        return withText(
          {
            ...(dry_run ? { dry_run: true as const } : {}),
            payee_id: existing?.id ?? null,
            created: !existing,
          },
          { name: existing?.name ?? name },
        );
      }
      let created = '';
      return loggedWrite(
        auditLog,
        'write_create_payee',
        {
          ids: [],
          changes: [{ id: 'new', field: 'name', before: null, after: name }],
        },
        async () => {
          created = await api.createPayee({ name });
          return { applied: [created], created: [created] };
        },
        async () => withText({ payee_id: created, created: true }, { name }),
      );
    },
    { scopes: ['structure:write'] },
  );
}
