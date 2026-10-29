# Proposal

## Why

Turning on `paychecks` turns on `businessCalendars`, but nothing stops the user from turning `businessCalendars` off again. In that state the paycheck editor still shows each deposit account's calendar and days early, contradicting `business-calendars` "Experimental feature flag". The link between the two flags is also hard-coded inside the generic flag hook and toggle (Shortcut sc-557).

## What Changes

- While the budget has a paycheck, the Business calendars toggle in Settings > Experimental can't be turned off. It's disabled, with a note: "Paychecks use business calendars. Delete your paychecks to turn this off."
- With no paycheck, turning Business calendars off also turns Paychecks off. Turning Paychecks on still turns Business calendars on.
- `paychecks` counts as on only while `businessCalendars` is on. So the paycheck editor's calendar fields, and every other paycheck entry point, are reachable only while both are on.
- The dependency is declared once, as a map saying `paychecks` requires `businessCalendars`. The generic flag hook and toggle read that map and lose their paycheck-specific branches, including the paychecks query in the flag hook.
- **Behavior change for one edge case:** an unset `paychecks` flag no longer starts on just because a paycheck exists. It starts on only when `businessCalendars` is on, which matches what the release before the `paychecks` flag showed (see design.md, Product decisions 1).

Non-goals: gating server handlers, data or date math (ADR 6); deleting or hiding paycheck data when a flag is off; any server change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `business-calendars`: "Experimental feature flag" can't be turned off while a paycheck exists, and turning it off turns `paychecks` off.
- `paychecks`: "Paychecks feature" counts as on only while `businessCalendars` is on, and an unset flag starts on only when `businessCalendars` is on.

## Impact

- Code: `packages/desktop-client` only:
  - `hooks/useFeatureFlag.ts`: declared requirements and defaults, and no paychecks query.
  - `components/settings/Experimental.tsx`: `FeatureToggle` applies the requirements generically. The Business calendars row passes the paycheck lock and note.
  - Tests in `hooks/useFeatureFlag.test.tsx` and `components/settings/Experimental.test.tsx`.
- Server, data and API: none. Synced prefs `flags.paychecks` and `flags.businessCalendars` keep their names and values.
- Consistent with ADR 6, the feature-flag policy (PR #71): UI-only gating, flags hide UI and not data, and dependencies are declared in one map.
