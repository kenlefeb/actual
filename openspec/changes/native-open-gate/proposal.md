# Proposal

## Why

Story sc-5463. The page posts `ready` as soon as its native bridge installs, before its own reopen has loaded the budget. A native screen that reads on `ready` (Accounts, Paychecks, Budget) could reach loot-core while the database was still opening and fail with a null database handle, showing its failed state with Retry at launch.

## What Changes

- Native reads wait, up to 4 seconds, while a budget load is in progress, then run. If the wait runs out they answer `budget-not-open`.
- With no load in progress (first launch with no budget, a budget closed on purpose, a failed open) they answer `budget-not-open` at once.
- A few handlers run before any budget opens and are never held.
- The wait is a fixed constant, a named exception to the limits rule like the 60 s read deadline: limits are stored in the budget that is still opening, so none can be read then, and the Swift bridge's read deadline is 5 seconds. Story sc-5269 covers every deadline that cannot live in the budget's preferences (the 60 s read deadline, this 4 s wait, the bridge's 5 s deadline) with a device-level setting.

Not in this change: a `budget-opened` event so a screen re-reads by itself after a wait that ran out (a separate story, before TestFlight).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `native-bridge`: new requirements "Native reads wait for a pending open", "Native reads answer at once when no open is pending" and "The open wait is a fixed constant". ADDED only.

## Impact

- **Code:** `packages/loot-core/src/server/native/open-gate.ts`, `budgetfiles/app.ts`, `main.ts`, `native/app.ts`. No Swift change.
- **Screens at launch:** a native screen that read during the open now loads instead of showing Retry; with no budget it shows the same failed state as before.
