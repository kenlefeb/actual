# Tasks

## 1. Desktop note Enter behavior

- [x] 1.1 In `packages/desktop-client/src/components/transactions/TransactionsTable.test.tsx`, next to "edits multiple lines with Shift+Enter without saving early", add a test that edits row 0's note to `First`, presses `{End}{Shift>}{Enter}{/Shift}Second{Enter}`, then asserts `getTransactions()[0].notes` is `'First\nSecond'` and `expectToBeEditingField(container, 'notes', 1)`; verify it passes with `yarn workspace @actual-app/web run test TransactionsTable`

## 2. Sync-disabled status

- [x] 2.1 In `packages/desktop-client/src/components/mobile/MobileSyncStatus.test.tsx`, add a test with the server online that emits `{ type: 'success', syncDisabled: true }` and asserts the status reads "Local file — not syncing" and no "Sync with server" button exists; verify it passes with `yarn workspace @actual-app/web run test MobileSyncStatus`

## 3. Formatter scope

- [x] 3.1 Add `ignorePatterns` to `.oxfmtrc.json` covering `openspec/` and the OpenSpec-generated skills, commands and prompts in `.agents/`, `.claude/`, `.cursor/` and `.github/`, so `openspec init`/`openspec update` output never fails the format check; verify `oxfmt --check .` reports no files from those paths

## 4. Integration checks

- [x] 4.1 Run `yarn typecheck` and `yarn lint` from the repository root and verify both pass with the new tests

## Workflow follow-up

- If a new test fails, stop and report it: the behavior is broken, and fixing it is a separate change.
- Archive the change after review so `transaction-notes` gains the Enter scenario.
- Committing these tests changes source, so per `AGENTS.md` any build from it needs a new `26.10.1-alpha.N` version and release note in `actual-hosting`; tests alone do not require a new build.
