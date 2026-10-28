# Proposal

## Why

A paycheck is several money moves on different dates: the employer pays gross pay less deductions on its pay date, and each bank receiving a direct deposit may credit it days earlier according to its own calendar. Actual can only record this as unrelated schedules, so the budget sees net deposits on bank dates, loses the gross pay and deductions, and the parts drift apart when amounts or holidays change. This is the fourth and last step of the paycheck plan, after `business-calendars`, `schedule-business-days` and `schedule-relative-dates`.

## What Changes

- **Account business days**: any account can have a business calendar, and receiving accounts can say how many business days early direct deposits arrive (for example "2 business days early" in U.S. Federal Reserve).
- **Paychecks**: a paycheck editor defines an employer's paycheck: the pay-date pattern, gross pay with its income category, deductions (each to a category or as a transfer, such as a 401(k) to an off-budget retirement account), and direct deposits to receiving accounts with a fixed amount, a percent of net pay, or the remainder.
- Each employer has an **on-budget clearing account** (created by the editor or chosen from existing accounts) that holds the employer calendar. Saving a paycheck keeps a group of schedules in step:
  - one **pay schedule** on the clearing account, on the employer's pay dates moved off the employer calendar's non-business days, posting one split transaction of gross pay and deductions;
  - one **deposit schedule** per direct deposit, on the receiving account, dated relative to the pay schedule by that account's early-deposit rule, as a transfer from the clearing account.
- Bank-synced deposits link to their deposit schedules by approximate amount and date instead of creating duplicates.
- Changing an account's calendar or early-deposit rule updates the deposit dates of every paycheck depositing to it.
- **Skip next paycheck** skips the next pay date and its deposits together.
- Desktop only, behind the existing `businessCalendars` experimental flag. Mobile shows the resulting schedules and transactions as usual.

Out of scope: payroll tax calculation, amounts that change per paycheck (each paycheck repeats its defined amounts; actual transactions can be edited after posting), shared bank records across accounts, and a mobile paycheck editor.

## Capabilities

### New Capabilities

- `account-business-days`: an account's business calendar and the number of business days early its direct deposits arrive.
- `paychecks`: defining an employer paycheck (pay dates, gross pay, deductions, direct deposits) and keeping its clearing account and schedules in step.

### Modified Capabilities

None. `business-calendars`, `schedule-business-days` and `schedule-relative-dates` are used unchanged.

## Impact

- Data: a migration adds the account calendar and early-deposit days to accounts and a `paychecks` table holding each definition and the ids of its schedules. Older clients ignore both and see ordinary schedules.
- Code: `packages/loot-core` paycheck server handlers (create, update, delete, skip) that write schedules, rules and the clearing account in one undoable mutation, and account-setting handlers that refresh affected deposit schedules; `packages/desktop-client` paycheck editor modal, schedules page entry point, and an account "Business days" settings modal.
- API: the account type documents the two new fields; paychecks are not part of the public API yet.
