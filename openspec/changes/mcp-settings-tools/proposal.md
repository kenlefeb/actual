# Proposal

## Why

This change is the MCP half of story sc-4643, in epic 470. It was split out of `native-settings-screen` (sc-4300 and sc-4643, PR #437) at review, so that the iPhone Settings tab and the Limits screen can build and archive without waiting for the MCP review.

Ken's rule is that MCP agents can do everything a user can. A person can change budget preferences and limits in Settings; an agent cannot yet. The agent's power stays limited by a scope that no grant holds unless it lists it.

Reviews this change answers, on PR #437:
- Architect, finding 3;
- Security, findings 1 to 3;
- Product Owner, finding 2.

## What Changes

- **Group 1 (sc-4643):** two tools.
  - `get_settings` (`budget:read`) returns the budget preferences and the `LIMITS` registry limits, with their defaults and ceilings.
  - `write_update_settings` (`settings:write`, a new scope) changes them through the same engine function that `native/settings-save` uses.
- **Closed list.** The tools reach only the native save's keys: the budget preferences and the `LIMITS` ids. They never reach:
  - the server address, encryption, sign-in, sync, keys or native-screen switches;
  - any limit that bounds the MCP server itself;
  - any default or ceiling.
- **Audit, undo and confirm.**
  - Each key is logged with its value before and after.
  - The write is undoable: `write_undo` restores the before values while each key still holds its after value.
  - A change to `budgetType` or to any limit always gets a dry run and a `confirm` first, whatever `confirm_destructive` says.

Mobile scope: none. This change adds MCP tools only; the screens are in `native-settings-screen`.

Not in this change:
- the native and web Settings screens and the engine handler (`native-settings-screen`);
- moving any MCP server limit into settings, which is never planned (design D2).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `mcp-server`: the `settings:write` scope, and the settings tools with their closed list, audit, undo and confirm.

## Impact

- **MCP code:**
  - `packages/mcp/src/tools/write/settings.ts` (new) and a read tool;
  - `grants.ts`: the scope, and the grants schema;
  - `undo.ts`: a settings planner in the undo table;
  - `shared.ts`: the always-confirm rule;
  - `coverage.json`, `README.md` and tests.
- **loot-core:** none beyond `native-settings-screen` group 1, which this change needs and which comes first.
- **Production:** adding `settings:write` to the production grant is a production change and needs Ken's explicit approval. Until he gives it, production agents can read settings but not change them.
- **Reviews:** Security Analyst (scope, closed list, audit, undo), Architect and Product Owner.
