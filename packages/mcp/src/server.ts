import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';

import type { RegisterTool } from '#tools/read/shared';

import { Refusal } from './refusal';
import { DATA_NOTE, scrubSecrets } from './sanitize';
import { registerAccountTools } from './tools/read/accounts';
import { registerCalendarTools } from './tools/read/calendars';
import { registerCoreTools } from './tools/read/core';
import { registerPaycheckTools } from './tools/read/paychecks';
import { registerWriteTools } from './tools/write/register';
import { version } from './version';

const READ_NOTE = ` Read-only. ${DATA_NOTE}`;
const WRITE_NOTE = ` Changes the budget; ids only, at most 50 rows, every write is audit-logged first. ${DATA_NOTE}`;

export type ServerOptions = {
  /** Registers the `write_` tools, logging each write here first. */
  auditLog?: string;
  /** Called with a tool's name and outcome, never its arguments or result (the hosted entry's access record). */
  onToolCall?: (tool: string, status: 'ok' | 'error') => void;
  /** Extra read tools, for an entry that adds its own (the hosted entry's `get_sync_status`). */
  registerExtra?: (tool: RegisterTool) => void;
};

export function createServer(
  secrets: string[] = [],
  { auditLog, onToolCall, registerExtra }: ServerOptions = {},
) {
  const server = new McpServer({ name: 'actual-budget', version });

  // Amounts are integer minor units (cents).
  const register =
    (suffix: string) =>
    <S extends z.ZodRawShape>(
      name: string,
      description: string,
      shape: S,
      fn: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>,
    ) => {
      const callback = async (
        args: z.infer<z.ZodObject<S>>,
      ): Promise<CallToolResult> => {
        try {
          const result = await fn(args);
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
          process.stderr.write(
            `${name} failed: ${scrubSecrets(detail, secrets)}\n`,
          );
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
        { description: description + suffix, inputSchema: shape },
        callback as unknown as ToolCallback<S>,
      );
    };

  const tool = register(READ_NOTE);
  registerCoreTools(tool);
  // Fork read tools, split by area (tools/read/*)
  registerPaycheckTools(tool);
  registerCalendarTools(tool);
  registerAccountTools(tool);
  registerExtra?.(tool);

  // Write tools exist only on the `--writes` entry (tools/write/*)
  if (auditLog) {
    registerWriteTools(register(WRITE_NOTE), auditLog, m =>
      scrubSecrets(m, secrets),
    );
  }

  return server;
}
