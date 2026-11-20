# Tasks

## 1. loot-core: reads wait for a pending open (sc-5463)

- [x] 1.1 Failing tests first for the gate: waits then runs, outlasts the wait, idle answers at once, a failed open answers at once, closed on purpose answers at once, the ungated handlers
- [x] 1.2 `native/open-gate.ts`: open flag, pending-open counter, 4 s constant; `main.ts` combines the gated copy; the test hook ungates itself from its own registration
- [x] 1.3 `budgetfiles/app.ts`: `loadBudget` and `_loadBudget` count as a pending open; `closeBudget` clears the flag; the flag is set right after `clearUndo()`, before the upload step, with a test
- [x] 1.4 Architect and Product Owner review of this spec delta
- [ ] 1.5 Archive this change when sc-5463 and its `budget-opened` follow-up story are done
