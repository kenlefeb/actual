# Proposal

## Why

Shortcut sc-2004 (Ken, 2026-11-01): once production holds real budgets or customers, nothing may tell the development team apart from Ken's personal AI assistant by luck of what they can reach. Today there is one shared sync-server password that opens every budget; the production login is a Private item, but the staging and tooling credentials live in "Ken & Agents", which every development agent reads; and agent sessions in Claude Desktop and Claude Code see the same local MCP entries and claude.ai connectors as Ken's chats (the `actual-production` tools were listed in a Claude Code session on 2026-11-01).

That is acceptable only while production is disposable. This change makes the separation a rule with checks: a server identity for the assistant, one place its credential lives, one path it reaches production by, a log that says who acted, and the order and steps to get there. It gates the production slice of sc-1950 (`mcp-remote`) and any real production MCP install, and is the server-side slice that sc-1555 asked for. Findings and the options weighed are on sc-2004 (Security Analyst 2005, Architect 2006, PO decision 2007).

## What Changes

- **New capability `production-identities`:** production runs Actual in OpenID multi-user mode with password login off; the assistant is one BASIC user with access to only the budgets Ken shares with it; development agents have no production user; a long-lived session token that Ken mints is the assistant's headless credential; every MCP audit line and the sync server's requests carry the acting identity; the order is LOCKDOWN first.
- **`design.md`:** the facts about the sync server this rests on, the credential rule, what each existing password user (browser sign-in, `RESTORE.md`, the LOCKDOWN password steps, the backup tooling) becomes, the account split, and the migration order.
- **Slices A to F** in `tasks.md`, each a future story filed when this merges.

The identity provider, its client registration and the hostname are named configuration here, not decisions: Ken's choice is still open and is needed before slice C's staging rehearsal. Non-goals: a server-enforced read-only grant (a separate Backlog story if Ken wants defense in depth), write tools on production, per-client limits, and giving development agents any production access (break-glass is a planned, Ken-approved step, not a standing path).

## Capabilities

### New Capabilities

- `production-identities`: separate identities, credential store, access path, audit trail and migration for the assistant and the development team on production.

### Modified Capabilities

- `mcp-server`: audit lines gain the acting identity (slice A). The requirement text is edited in the slice that ships it, not here.
