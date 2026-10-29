# Tasks

## 1. Contract

- [ ] 1.1 Spec deltas for `business-calendars` "Experimental feature flag" and `paychecks` "Paychecks feature"; verify with `openspec validate business-calendars-required-by-paychecks --strict`

## 2. Declared dependency in the flag hook

- [ ] 2.1 In `hooks/useFeatureFlag.test.tsx`, replace "is on when unset and a paycheck exists (upgrade)" with failing tests named after the scenarios:
  - "Upgrade with business calendars off": unset `paychecks` with a paycheck and calendars unset or off is off, and no paychecks query is sent.
  - "Acme stays hidden while business calendars are off": `flags.paychecks` `'true'` with `flags.businessCalendars` `'false'` is off.

  Keep the other tests ("is on when unset and business calendars are on", "stays off when explicitly turned off"). Then add `FEATURE_FLAG_REQUIRES` and the `'withRequirements'` default, apply them in `useFeatureFlag`, and remove the paychecks query and the `paychecks` branch. Verify the tests pass and that `grep -n paycheck hooks/useFeatureFlag.ts` finds only the map entries

## 3. Settings toggles

- [ ] 3.1 In `components/settings/Experimental.test.tsx`, add failing tests named after the scenarios:
  - "Turning off business calendars with no paycheck turns off paychecks": both prefs become `'false'`.
  - "Can't turn off while the Acme paycheck exists": with `paychecks-get` returning Acme and both flags on, the Business calendars checkbox is disabled and the note text shows.
  - "Unlocked after the last paycheck is deleted": with no paycheck, the checkbox is enabled and the note is absent.

  Keep the existing "turns on business calendars with paychecks" and "leaves business calendars on when paychecks is turned off" tests. Then make `FeatureToggle` write requirements on enable and dependents on disable from `FEATURE_FLAG_REQUIRES`, remove its hard-coded `paychecks` branch and its `flags.businessCalendars` pref, and pass `disableToggle` and the note from the Business calendars row in `ExperimentalFeatures`. Verify the tests pass and that `FeatureToggle` contains no flag names

## 4. Integration checks

- [ ] 4.1 Run the settings, flag, schedules, paychecks and mobile schedules tests in desktop-client, `yarn typecheck` and `yarn lint`; all pass
- [ ] 4.2 In the app, check each case: with a paycheck and both flags on, the Business calendars toggle is disabled with the note; after the paycheck is deleted it can be turned off, and Paychecks turns off with it; turning Paychecks on turns both on

## Workflow follow-up

- Archive the change when sc-557 merges.
- The release that ships this notes the edge case in design.md, Product decisions 1.
