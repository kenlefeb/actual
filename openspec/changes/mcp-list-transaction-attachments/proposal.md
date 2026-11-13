# Proposal

## Why

An agent connected to the MCP server cannot tell which transactions carry a receipt or invoice (sc-2526). It needs a read-only list of each transaction's attachment metadata. Documents themselves are never exposed, and the Receipts inbox confirm flow stays the only write path.

## What Changes

- Adds a read tool `list_transaction_attachments` to `packages/mcp`. It queries the budget's `transaction_attachments` rows through the API and returns id, name, type, size and created time. No document content, hash or encryption data. No new handler or API method is needed.
- Adds a requirement to `transaction-attachments`, and names the tool in `mcp-server` "Fork read tools".
- Returns an attachment's type only when it is one the app accepts (else `unknown`), and cleans a non-plain id the way paychecks do.
- Out of scope: any MCP tool that attaches, opens or removes a document (attaching is sc-2665).

Mobile scope: none; the MCP server is not a screen. No Ken-approved exception is needed.

## Capabilities

### New Capabilities

- none

### Modified Capabilities

- `transaction-attachments`: adds "Attachment metadata over MCP".
- `mcp-server`: "Fork read tools" lists `list_transaction_attachments`.
