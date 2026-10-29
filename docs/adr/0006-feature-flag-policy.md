# 6. Feature-flag policy for fork features

Fork-only; never upstream. Accepted 2026-10-29.

## Context

Fork features ship behind upstream's experimental flags, which are synced
prefs `flags.<name>` declared in
[`types/prefs.ts`](../../packages/loot-core/src/types/prefs.ts). The fork's
flags are `businessCalendars` and `paychecks`, and paychecks need business
calendars.

## Decision

- **Gate only the UI.** Flags hide the entry points: menus, rows, buttons and
  editors. Server handlers, stored data, date math and the API are not gated.
- **Turning a flag off hides the UI, not the data.** Schedules that already use
  a calendar or a relative date keep computing those dates
  (`schedule-business-days` and `schedule-relative-dates`, "Feature turned off
  later"). Paychecks keep their schedules.
- **Dependent flags.** A flag's dependencies are declared once, in
  `FEATURE_FLAG_REQUIRES` (`paychecks` requires `businessCalendars`). A flag
  counts as on only while the flags it requires are on. Turning it on turns
  them on, and turning one of them off turns it off. An unset `paychecks` flag
  counts as on exactly when `businessCalendars` is on (`paychecks`, "Paychecks
  feature"). While a paycheck exists, the `businessCalendars` toggle can't be
  turned off (`business-calendars`, "Experimental feature flag").

## What the code does today

- [`useFeatureFlag.ts`](../../packages/desktop-client/src/hooks/useFeatureFlag.ts)
  declares `FEATURE_FLAG_REQUIRES` and applies it for every flag. `paychecks`
  defaults to on, so an unset flag follows `businessCalendars`. The hook reads
  all flags with one selector and runs no queries.
- [`Experimental.tsx`](../../packages/desktop-client/src/components/settings/Experimental.tsx)
  `FeatureToggle` writes a flag's requirements on and its dependents off,
  one pref key at a time. It has no flag names. The Business calendars row in
  the feature list passes the paycheck lock (`disableToggle` and
  `disabledReason`).

## Consequences

- API scripts and synced devices see fork data whatever the flags say on any
  one device.
- A new fork flag declares any flag it depends on in
  `FEATURE_FLAG_REQUIRES`. It never adds feature-specific branches to
  `useFeatureFlag` or `FeatureToggle`.
- Each spec states its "hidden when the feature is off" scenario, plus what
  happens to existing data when the feature is turned off.

## Links

- Specs: `business-calendars` ("Experimental feature flag"), `paychecks`
  ("Paychecks feature"), `account-business-days`, `paycheck-planning`.
- Story: sc-557.
