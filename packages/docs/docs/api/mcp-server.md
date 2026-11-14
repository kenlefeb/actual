---
title: 'MCP Server'
---

# MCP Server

The `@actual-app/mcp` package lets an AI assistant that speaks the [Model Context Protocol](https://modelcontextprotocol.io) (such as Claude Code or Claude Desktop) read your budget. It is read-only by default. It talks to the assistant over standard input and output and opens no network port.

:::note
This server ships with Ken's Actual fork and is released with the same version number as the other fork packages. It is not part of upstream Actual.
:::

## Before You Start

- Node.js v22 or higher.
- A running sync server you can reach, and your budget's Sync ID.
- A [1Password Environment](https://www.1password.dev/environments/) holding the variables below, mounted as a local `.env` file (1Password calls this a local .env file).

## Keep Credentials in 1Password

The server needs your sync server password, and sometimes an end-to-end encryption password. Treat both as secrets:

- Credentials come from a 1Password Environment (for Ken's agents, "Actual Agents") mounted as a local `.env` file, and only from there.
- Never export them in a shell profile (such as `~/.zshrc`), and never write them into `.mcp.json` or `~/.claude.json`.
- Never pass them as command-line arguments. The server refuses any argument it does not recognize.

## Build the Server

From the root of the repository, run:

```bash
yarn build:mcp
```

This creates `packages/mcp/dist/mcp.js`.

## Mount the Env File

In 1Password, create an Environment with these variables and mount it as a local `.env` file outside the repository, for example `~/.config/actual-agents/.env`. 1Password serves the file only while it is unlocked, and asks you to approve the first read. The file never holds secrets on disk, and you never copy them into the repository:

```bash
ACTUAL_SERVER_URL=<url>
ACTUAL_PASSWORD=<password>
ACTUAL_SYNC_ID=<sync id>
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

Add the server to your assistant's MCP settings, loading the mounted env file with Node's `--env-file` option, so the variables exist only in that process:

```json
{
  "mcpServers": {
    "actual-staging": {
      "command": "node",
      "args": [
        "--env-file=/path/to/actual-agents/.env",
        "/path/to/actual/packages/mcp/dist/mcp.js"
      ]
    }
  }
}
```

Restart your assistant. It should now list tools such as `list_accounts` and `get_budget_month`.

## Allow Changes (Optional)

To let the assistant change your budget, add a second, separate entry that runs the server with `--writes`, so you can load the read-only entry without it:

```json
"actual-staging-writes": {
  "command": "node",
  "args": [
    "--env-file=/path/to/actual-agents/.env",
    "/path/to/actual/packages/mcp/dist/mcp.js",
    "--writes"
  ]
}
```

This entry adds five tools whose names start with `write_`: create transactions, change a transaction's category, payee or notes, set a budget amount, skip a paycheck, and move an account on budget. Each write is recorded in a private audit log before it runs; if the log can't be written, the change doesn't happen. A second line records the outcome, with the ids of anything created; if only that line fails, the change stands and the result says `audit_outcome` is `not-logged`. A multi-row update stops at the first row the engine rejects and reports which rows changed. A write is refused before it is logged when an amount is not an integer within ±1,000,000,000,000 cents, a date is not a real date from 1970 to 2100, or a budget month is not a real month.

The write entry keeps its own copy of the budget (`<env>-writes` and `<env>-writes.audit.jsonl` beside the read entry's `<env>`), so a write that ends before it syncs never sits in the copy a read entry syncs. Its first start downloads the budget again. The two entries always get separate copies; if you set `ACTUAL_DATA_DIR`, the write entry uses that path with `-writes` added. If you used the read directory for a write session before this change, stop the read entry first, then delete that directory once, for example `rm -r "$HOME/Library/Application Support/actual-mcp/staging"`.

`--writes` is never allowed for production. With `ACTUAL_MCP_ALLOW_PRODUCTION=1`, the server connects to production read-only.

## Notes on Syncing

Without `--writes` the server starts the engine read-only (`init({ readOnly: true })`), so a sync never posts schedules, reconciles paychecks or uploads the budget, and sends nothing to the server. It still pulls the server's changes. The `--writes` entry runs the engine as the app does.

For the full list of tools and settings, see the [package README](https://github.com/kenlefeb/actual/blob/development/packages/mcp/README.md).
