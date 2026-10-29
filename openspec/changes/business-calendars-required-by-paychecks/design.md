# Design

## Context

See proposal.md and the deltas in specs/.

- `hooks/useFeatureFlag.ts` reads `flags.<name>` (a synced pref, stored as the string `'true'` or `'false'`, or unset), falling back to `DEFAULT_FEATURE_FLAG_STATE`. For `paychecks` it has a special branch: when the flag is unset and `businessCalendars` isn't on, it runs the paychecks query and treats the flag as on if any paycheck exists. That's a paycheck query inside the generic hook.
- `components/settings/Experimental.tsx` `FeatureToggle` (lines 47-73) writes `flags.<name>`, and, hard-coded, also writes `flags.businessCalendars = 'true'` when `paychecks` is turned on. Nothing handles turning `businessCalendars` off, so `paychecks` can stay on with calendars off. In that state `PaycheckFormFields.tsx:390` still shows each deposit account's calendar and days early.
- `FeatureToggle` already supports `disableToggle`, `error` (shown only while disabled) and `note`, and other rows pass them from the feature list in `ExperimentalFeatures`.
- Before the `paychecks` flag existed (sc-56), paychecks were shown only while `businessCalendars` was on (`git show 5f7ae1594^`, `components/schedules/index.tsx`).
- ADR 6 (PR #71) sets the policy: gate only the UI, a flag hides UI and not data, and dependencies go in one "requires" map, with no feature branches in `useFeatureFlag` or `FeatureToggle`.

## Goals / Non-Goals

**Goals:**
- The dependency is declared in one place, and the generic hook and toggle follow it.
- No state where paycheck UI shows while `businessCalendars` is off.

**Non-Goals:**
- Gating server handlers, data or date math, or changing synced pref names or values.
- A general dependency engine (chains, cycles, many-to-many). There is one edge today, and the map handles a list per flag without recursion.

## Decisions

### Declare requirements and defaults next to the flag defaults
In `useFeatureFlag.ts`, beside `DEFAULT_FEATURE_FLAG_STATE`, export:
```ts
// Which flags each flag needs (ADR 6)
export const FEATURE_FLAG_REQUIRES: Partial<Record<FeatureFlag, FeatureFlag[]>> = {
  paychecks: ['businessCalendars'],
};
```
For defaults, an unset flag may default to "on when its requirements are on" instead of a boolean: `paychecks: 'withRequirements'` in `DEFAULT_FEATURE_FLAG_STATE`. That's declared data, not a branch.
- Alternative: a `requires` field in `types/prefs.ts` (loot-core). Rejected because flags gate only the UI (ADR 6), so the map belongs with the client's flag defaults. loot-core keeps only the flag names.

### `useFeatureFlag` applies the map generically
A flag counts as on only when its stored value (or declared default) is on and every flag it requires is on. The hook reads the required flags' synced prefs with the same rule, which is one level deep because of the non-goal above. The paychecks query is removed from the hook.
- This alone guarantees "Acme stays hidden while business calendars are off". Every paycheck entry point uses `useFeatureFlag('paychecks')`, so the editor's calendar fields can't be reached without both flags.

### `FeatureToggle` applies the map when writing
Turning a flag on also writes `'true'` for each flag it requires. Turning a flag off also writes `'false'` for each flag that requires it. This replaces the hard-coded `paychecks` branch, and the existing `onDisable` callback still runs.
- Writing `'false'` to `flags.paychecks`, rather than leaving it unset, keeps the user's choice when calendars are turned back on, so paychecks don't reappear by themselves.

### The paycheck lock lives on the Business calendars row in the feature list
`ExperimentalFeatures` renders `<FeatureToggle flag="businessCalendars" disableToggle={isLocked} error={…note…}>`, where `isLocked = businessCalendarsEnabled && paychecks.length > 0`, using `usePaychecks()`. The note uses the existing `error` slot, which shows only while the toggle is disabled: "Paychecks use business calendars. Delete your paychecks to turn this off."
- The feature list is where feature-specific row props already live (deprecation notes, the plugins row's `disableToggle`), so the generic component stays free of paycheck code.
- The lock applies only while calendars are on, so a budget left with calendars off can still turn them on.
- Alternative: a generic "locked while in use" hook declared in the map. Rejected for now because there's one case, and the data query would come back into generic code.
- Style: the `error` slot renders in `errorText`. If the Product Owner prefers a neutral tone, add an optional style to the row's details, without changing the behaviour.

### Unset `paychecks` defaults with its requirement only
The "a paycheck exists" default is dropped (Product decisions 1). An unset flag counts as on exactly when `businessCalendars` is on. This keeps "Existing paychecks stay visible on upgrade", whose budget has calendars on. It also matches what users saw before the flag: paychecks were hidden whenever calendars were off.

## Product decisions

For the Product Owner to confirm (recommendations given):

1. **Unset `paychecks` with a paycheck but calendars off:** recommendation: it counts as off ("Upgrade with business calendars off"). Today it counts as on, which is exactly the contradictory state this story removes, and the release before the flag hid paychecks in that state. Turning Paychecks on brings everything back.
2. **Lock note wording and tone:** "Paychecks use business calendars. Delete your paychecks to turn this off." shown in the row's error style. Recommendation: keep the story's wording, and accept the error style or ask for a neutral one.
3. **Synced devices:** the lock is checked on the device whose Settings are open. If another device creates a paycheck while this one turns calendars off, both flags end up off and the paycheck is hidden but kept. Recommendation: accept, since no data is lost and turning Paychecks on restores it.

## Risks / Trade-offs

- [Existing budgets in the edge state lose visible paychecks until Paychecks is turned on] → No data changes. This applies only to budgets with calendars explicitly off, and the release note says so.
- [`useFeatureFlag` now reads a second synced pref for flags with requirements] → It's a cheap selector, and the paychecks query it removes was costlier.
- [A future flag that requires another flag with its own requirement] → The non-goal keeps one level. A second level would need the map to be walked recursively, a small and testable change.

## Migration Plan

None: no data or pref migration. Users in the edge state see Paychecks off and can turn it on. Rolling back the change restores the old derivation.
