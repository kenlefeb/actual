---
title: 'MCP Server'
---

# MCP Server

The `@actual-app/mcp` package lets an AI assistant that speaks the [Model Context Protocol](https://modelcontextprotocol.io) (such as Claude Code or Claude Desktop) read your budget. It is read-only: it offers no tools that change your data. It talks to the assistant over standard input and output and opens no network port.

:::note
This server ships with Ken's Actual fork and is released with the same version number as the other fork packages. It is not part of upstream Actual.
:::

## Before You Start

- Node.js v22 or higher.
- A running sync server you can reach, and your budget's Sync ID.
- The [1Password CLI](https://developer.1password.com/docs/cli/) (`op`), signed in.

## Keep Credentials in 1Password

The server needs your sync server password, and sometimes an end-to-end encryption password. Treat both as secrets:

- Credentials come from the "Ken & Agents" 1Password vault and the `op run` env file only.
- Never export them in a shell profile (such as `~/.zshrc`), and never write them into `.mcp.json` or `~/.claude.json`.
- Never pass them as command-line arguments. The server refuses any argument it does not recognize.

## Build the Server

From the root of the repository, run:

```bash
yarn build:mcp
```

This creates `packages/mcp/dist/mcp.js`.

## Create the Env File

Create a file outside the repository, for example `actual-mcp-staging.env`. It holds `op://` references, not the secrets themselves, so replace each placeholder with the path of the matching item in the "Ken & Agents" vault:

```bash
ACTUAL_SERVER_URL=op://Ken & Agents/<item>/url
ACTUAL_PASSWORD=op://Ken & Agents/<item>/password
ACTUAL_SYNC_ID=op://Ken & Agents/<item>/sync id
```

| Variable                      | Required | Description                                                          |
| ----------------------------- | -------- | -------------------------------------------------------------------- |
| `ACTUAL_SERVER_URL`           | Yes      | URL of the sync server.                                              |
| `ACTUAL_PASSWORD`             | Yes      | Sync server password.                                                |
| `ACTUAL_SYNC_ID`              | Yes      | Budget Sync ID.                                                      |
| `ACTUAL_ENCRYPTION_PASSWORD`  | No       | Password for an end-to-end encrypted budget.                         |
| `ACTUAL_DATA_DIR`             | No       | Where the local copy of the budget lives. It must be private (0700). |
| `ACTUAL_MCP_ALLOW_PRODUCTION` | No       | Set to `1` to allow a server other than localhost or staging.        |

The server refuses a data folder that is under Dropbox, iCloud, Obsidian, `~/Documents` or `~/Desktop`, because the local copy of your budget is not encrypted.

## Register the Server with Your Assistant

Add the server to your assistant's MCP settings, wrapping it in `op run` so 1Password supplies the variables only for that process:

```json
{
  "mcpServers": {
    "actual-staging": {
      "command": "op",
      "args": [
        "run",
        "--env-file=/path/to/actual-mcp-staging.env",
        "--",
        "node",
        "/path/to/actual/packages/mcp/dist/mcp.js"
      ]
    }
  }
}
```

Restart your assistant. It should now list tools such as `list_accounts` and `get_budget_month`.

## Notes on Syncing

Every sync, including the one when the server starts, runs the same after-sync work as the app. This can post due schedules and reconcile paychecks, and the next sync sends those changes to the server.

For the full list of tools and settings, see the [package README](https://github.com/kenlefeb/actual/blob/development/packages/mcp/README.md).
