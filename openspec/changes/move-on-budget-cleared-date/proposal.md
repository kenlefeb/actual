# Proposal

## Why

In the "Move on budget" dialog, clearing the start date leaves the old preview on screen with the date missing from its sentences ("Your budget gains 3,243.86 on , in Starting Balances", "7 transactions from  need a category"), and Move is disabled with no reason given (Shortcut sc-1826, desktop and phone). `MoveOnBudgetModal.tsx` only fetches a preview for a valid date and never clears the previous one, and the disabled state has no visible cause.

`account-budget-status` says the counts follow the start date, but not what the dialog shows when there is no usable date.

## What Changes

- **Spec:** adds the requirement "A cleared or invalid start date": with an empty or invalid date the dialog shows no preview numbers and a short hint to choose a start date, Move stays disabled, and a valid date brings the preview back.
- **Behavior (the story's implementation):** the dialog clears the preview when the date is not usable, shows the translated hint "Choose a start date" in its place, and treats an impossible date such as 2026-02-31 the same way (the current check only tests the `YYYY-MM-DD` shape).

Non-goals: changing the default start date (sc-1530 does that, see design.md), and any change to the server's date check.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `account-budget-status`: adds one requirement.
