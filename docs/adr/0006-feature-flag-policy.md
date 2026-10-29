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
- **Dependent flags.** Turning `paychecks` on turns `businessCalendars` on.
  An unset `paychecks` flag counts as on when the budget already has a paycheck
  or `businessCalendars` is on (`paychecks`, "Paychecks feature"). Decided on
  sc-557 and not built yet: while a paycheck exists, `businessCalendars` can't
  be turned off. With no paycheck, turning `businessCalendars` off also turns
  `paychecks` off. The dependency is declared once, in a map of which flag
  requires which.

## What the code does today

- [`useFeatureFlag.ts:28-45`](../../packages/desktop-client/src/hooks/useFeatureFlag.ts)
  derives the unset `paychecks` flag with a paychecks query inside the
  generic hook.
- [`Experimental.tsx:47-73`](../../packages/desktop-client/src/components/settings/Experimental.tsx)
  hard-codes "turning on `paychecks` sets `businessCalendars`" in the generic
  toggle.
- Nothing stops `businessCalendars` being turned off while `paychecks` is on.
  In that state the paycheck editor still shows calendar and days-early fields
  (`PaycheckFormFields.tsx:390`). sc-557 fixes all three points.

## Consequences

- API scripts and synced devices see fork data whatever the flags say on any
  one device.
- A new fork flag declares any flag it depends on in the requires map (after
  sc-557). It never adds feature-specific branches to `useFeatureFlag` or
  `FeatureToggle`.
- Each spec states its "hidden when the feature is off" scenario, plus what
  happens to existing data when the feature is turned off.

## Links

- Specs: `business-calendars` ("Experimental feature flag"), `paychecks`
  ("Paychecks feature"), `account-business-days`, `paycheck-planning`.
- Story: sc-557.
