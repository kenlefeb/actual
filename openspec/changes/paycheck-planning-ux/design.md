# Design

## Context

See proposal.md for motivation and specs/ for the required behavior. Shaping constraints from the current code:

- Feature flags are synced per-budget preferences (`flags.<name>`) read through `useFeatureFlag`, which falls back to a static default when the preference is unset. There is no server-side flag check: paycheck schedules post regardless of the flag.
- Paycheck membership lives only in each paycheck's `definition` (`paySchedule`, `deposits[].schedule`, `clearingAccount`). Schedules and accounts carry no back-reference.
- `PaycheckEditor` is not compiled by the React Compiler (sc-55), so derived objects passed to hooks or children must be memoized by hand there, or the component split so the compiler can take the parts.
- Next dates (with skips) are stored per schedule (`next_date`); upcoming occurrences without skips come from `schedule/get-upcoming-dates`.

## Goals / Non-Goals

**Goals:**
- Ship in slices that each stand alone: flag → list → clearing-account marking and warning → editor additions → mobile editor.
- Derive everything from existing data (paycheck definitions, schedules, transactions); no new tables or migrations.

**Non-Goals:**
- Per-occurrence overrides; changing how schedules post or link imports.
- Making paychecks work with the flag off (server behavior is already flag-independent).

## Decisions

- **Flag default is derived, not migrated.** `useFeatureFlag('paychecks')` returns the stored value when set; when unset it returns `true` if `flags.businessCalendars` is on or any paycheck exists. No data migration, works for budgets opened on any device. Turning `paychecks` on in Settings also writes `flags.businessCalendars = true`; turning it off leaves calendars alone. *Alternative:* a one-time migration writing `flags.paychecks` — rejected: synced prefs written during load race across devices, and the derived default is idempotent.
- **One shared paycheck-membership index.** A client hook builds, from `usePaychecks()`, sets of paycheck schedule ids and a map clearing-account id → paycheck. The schedules list filters by it, the sidebar and register look up clearing accounts in it. *Alternative:* a `paycheck_id` column on schedules/accounts — rejected: needs a migration and duplicates the definition, which can drift (deleted-and-recreated schedules already update the definition).
- **Next/upcoming paychecks from the pay schedule.** The row's next date is the pay schedule's stored `next_date` (includes skips); deposit dates for that occurrence come from each deposit schedule's `next_date`. "Show more" uses `get-upcoming-dates` on the pay schedule's date config with deposit dates computed client-side by the shared relative-date code. "Skipped" is shown when the pay schedule's pattern has an occurrence before its stored `next_date` that hasn't posted (compare upcoming-without-skips to `next_date`).
- **Clearing-account warning computed on read.** For a clearing account, take its paycheck's most recent posted pay transaction date; the warning is active when the account balance ≠ 0 and every deposit's expected date for that occurrence + 2 business days (deposit account calendar) is before today. Missing deposits are those whose deposit schedule has no linked transaction for that occurrence. Computed in a loot-core handler so the sidebar, register and list share one answer. *Alternative:* a stored status — rejected: it would need refreshing on every import, edit and undo.
- **Year-to-date from posted splits.** A loot-core query sums the pay schedule's posted transactions (linked by `schedule` id) by year: split 1 is gross, deduction splits group by their notes (deduction name). Edited transactions count as posted. *Alternative:* recomputing from the definition × occurrences — rejected: misses one-off edits, which is the point of checking against a W-2.
- **Days early edited through the existing mutation.** The editor reuses `account-set-business-days` (which already rewrites every affected paycheck's schedules) when saving a changed value; no new server path.
- **Mobile editor shares the form model.** Extract the editor's state and validation (definition, errors, computed amounts) from `PaycheckEditor` into a hook used by both the desktop modal and a mobile page (`MobilePaycheckPage`, routed like other mobile edit pages). Splitting also lets the compiler memoize the pieces.

## Risks / Trade-offs

- [Derived flag default flips on for budgets that only use business calendars] → intended (they can already see "Add paycheck" today); they can turn it off.
- [Hiding paycheck schedules makes them hard to find when debugging] → rows and the editor link to them; `PaycheckScheduleNote` already explains the relationship.
- [Warning false positives for deposits entered by hand without linking] → "missing" means no linked transaction; the note text says to link the deposit, and a zero balance clears the warning regardless.
- [Year-to-date groups deductions by note text] → a renamed deduction splits into two lines; acceptable and visible.

## Migration Plan

No data migration. Rollback is a code revert; flags are preferences and stay harmless if unused.
