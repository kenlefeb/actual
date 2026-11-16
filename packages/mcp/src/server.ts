import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import type { RegisterTool } from '#tools/read/shared';

import { appendAudit } from './audit';
import type { AuditIdentity, Identity } from './audit';
import { actingUserId } from './connection';
import type { Grant } from './grants';
import { Refusal } from './refusal';
import { DATA_NOTE, scrubSecrets } from './sanitize';
import { registerAccountTools } from './tools/read/accounts';
import { registerAttachmentTools } from './tools/read/attachments';
import { registerCalendarTools } from './tools/read/calendars';
import { registerCoreTools } from './tools/read/core';
import { registerPaycheckTools } from './tools/read/paychecks';
import { registerWriteTools } from './tools/write/register';
import type { Access, WriteLog } from './tools/write/shared';
import { registerUndoTools } from './tools/write/undo';
import { version } from './version';
import { withWriteLock } from './write-lock';

const READ_NOTE = ` Read-only. ${DATA_NOTE}`;
const WRITE_NOTE = ` Changes the budget; ids only, at most 50 rows, every write is audit-logged first. ${DATA_NOTE}`;
const READ: Access = { scopes: ['budget:read'] };
const READ_ONLY: Grant = { scopes: ['budget:read'], confirm_destructive: true };

export type ServerOptions = {
  /** The audit log: write lines and `refused` lines go here first. */
  auditLog?: string;
  /** Written on every audit line; defaults to the connection's user id and subject `local` (stdio). */
  identity?: Identity;
  /** The connection's grant, looked up on every call; `budget:read` when not given. */
  grant?: () => Grant;
  /** The OAuth client id, which a destructive tool's `confirm` is bound to; `local` on stdio. */
  client?: string;
  /** Called with a tool's name and outcome, never its arguments or result (the hosted entry's access record). */
  onToolCall?: (tool: string, status: 'ok' | 'error') => void;
  /** Extra read tools, for an entry that adds its own (the hosted entry's `get_sync_status`). */
  registerExtra?: (tool: RegisterTool) => void;
};

export function createServer(
  secrets: string[] = [],
  {
    auditLog,
    identity,
    grant: grantOf = () => READ_ONLY,
    client = 'local',
    onToolCall,
    registerExtra,
  }: ServerOptions = {},
) {
  const server = new McpServer({ name: 'actual-budget', version });
  const who = identity ?? { user_id: actingUserId(), subject: 'local' };
  const scrub = (m: string) => scrubSecrets(m, secrets);

  // Every tool goes through here: the grant is checked before `fn` runs.
  // Amounts are integer minor units (cents).
  const register =
    (suffix: string) =>
    <S extends z.ZodRawShape>(
      name: string,
      description: string,
      shape: S,
      fn: (args: z.infer<z.ZodObject<S>>, log: WriteLog) => Promise<unknown>,
      access: Access,
    ) => {
      if (access.scopes.length === 0) {
        throw new Error(`${name} declares no scope.`);
      }
      const callback = async (
        args: z.infer<z.ZodObject<S>>,
      ): Promise<CallToolResult> => {
        try {
          const grant = grantOf();
          const audited: AuditIdentity = {
            ...who,
            scopes: grant.scopes,
            ...(grant.fingerprint ? { grant: grant.fingerprint } : {}),
          };
          const missing = access.scopes.filter(s => !grant.scopes.includes(s));
          if (missing.length > 0) {
            try {
              if (auditLog) {
                appendAudit(
                  auditLog,
                  { tool: name, phase: 'refused', missing },
                  audited,
                );
              }
            } catch {
              // Best effort: the refusal stands without its line.
            }
            throw new Refusal(
              `${name} needs ${access.scopes.join(' ')}; missing ${missing.join(' ')}; this connection was granted ${grant.scopes.join(' ') || 'nothing'}. Nothing changed.`,
            );
          }
          const run = () =>
            fn(args, {
              // No audit log means no write can run: appending to '' fails.
              path: auditLog ?? '',
              scrub,
              identity: audited,
              grant,
              client,
              args,
              destructive: Boolean(access.destructive),
            });
          // One write at a time per process: the before-read, the attempt line
          // and the write sit inside one lock, so a logged before is never stale.
          const result = await (suffix === WRITE_NOTE
            ? withWriteLock(run)
            : run());
          onToolCall?.(name, 'ok');
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  note: DATA_NOTE,
                  ...(result as object),
                }),
              },
            ],
          };
        } catch (error) {
          onToolCall?.(name, 'error');
          // Fixed text to the model; details (scrubbed) go to stderr only.
          const detail =
            error instanceof Error ? error.message : JSON.stringify(error);
          process.stderr.write(`${name} failed: ${scrub(detail)}\n`);
          // A refusal's message is fixed text of ours, never budget data.
          const reason = error instanceof Refusal ? ` ${error.message}` : '';
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `${name} failed.${reason} See the server log.`,
              },
            ],
          };
        }
      };
      // The SDK's generic callback type can't be inferred through our wrapper.
      server.registerTool(
        name,
        {
          description: `${description}${suffix} Needs: ${access.scopes.join(' ')}.`,
          inputSchema: (access.strict ? z.object(shape).strict() : shape) as S,
          annotations: {
            readOnlyHint: access === READ,
            destructiveHint: Boolean(access.destructive),
          },
        },
        callback as unknown as ToolCallback<S>,
      );
    };

  const read = register(READ_NOTE);
  const tool: RegisterTool = (name, description, shape, fn) =>
    read(name, description, shape, fn, READ);
  registerCoreTools(tool);
  // Fork read tools, split by area (tools/read/*)
  registerPaycheckTools(tool);
  registerCalendarTools(tool);
  registerAccountTools(tool);
  registerAttachmentTools(tool);
  registerExtra?.(tool);

  // Write tools on every entry; the grant decides which calls succeed (tools/write/*)
  const writeTool = register(WRITE_NOTE);
  registerWriteTools(writeTool);
  registerUndoTools(writeTool, (name, description, shape, fn) =>
    read(name, description, shape, fn, READ),
  );

  return server;
}
