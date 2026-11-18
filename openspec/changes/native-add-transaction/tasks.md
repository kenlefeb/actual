# Tasks

**Tests first:** write the tests, see them fail, then write the code.

**Order:** one PR per group, in order. Group 1 blocks group 2, which blocks group 3. All three ship story sc-3602.

## 1. Engine: form reads, preview, save, limits and gates (sc-3602)

- [ ] 1.1 `native/transaction-form` in `server/native/transaction-form.ts` (design D1).
  - Write failing contract tests first on a seed that has:
    - on-budget, off-budget and closed accounts;
    - hidden categories;
    - a split with a transfer child;
    - a reconciled row and a scheduled row.
  - The tests check:
    - names resolved;
    - the digest covers the parent, children and partners;
    - a deleted id fails, and a closed account's transaction fails.
  - Add the fixture `transaction-form.json`.
- [ ] 1.2 `native/payees` (design D1).
  - Write failing tests first:
    - favourites first, then by name;
    - transfer payees excluded;
    - search over 100 characters fails;
    - `%`, `_` and `\` match literally;
    - `payee-picker-max-results` defaults to 50, has a ceiling of 500, and malformed values fall back.
  - Add the limit to the `LIMITS` registry.
  - Add the fixture `payees.json`.
- [ ] 1.3 `native/transaction-preview` (design D2).
  - Write failing tests first, each comparing against `rules-run` with the web form's application rules:
    - arithmetic in each number format;
    - Inflow and Outflow;
    - rules applied only to a draft without an id;
    - a payee change re-applies every field;
    - other changes fill only empty fields and notes;
    - cleared fields stay empty;
    - a grouped split under a split rule;
    - the remainder;
    - each field-error code;
    - nothing is written.
  - Add the fixtures `transaction-preview.json` and `transaction-field-errors.json`.
- [ ] 1.4 `native/transaction-save` (design D3).
  - Write failing tests first:
    - the touched set (children removed, partners old and new) is computed before any write;
    - no undo token is refused;
    - `[native:changed-since]` for a changed parent, child or partner;
    - `[native:invalid-draft]` for each validation rule;
    - `[native:needs-confirmed-reconciled]` for a reconciled child or partner (`"true"` and `1` refused);
    - `transaction-split-max-children` defaults to 50, has a ceiling of 200, and malformed values fall back;
    - a new payee is created in the same undo step;
    - rules run again on add;
    - `learn-categories` is honoured;
    - an equal-input comparison with `transactions-batch-update` as the web calls it;
    - a repeated token returns the same id;
    - nothing changes on any refusal.
  - Add `changed-since` to `native-refusal-codes.json`.
- [ ] 1.5 Undo conflict check for saves (design D3). The save records the digest fields it left. `native/undo` refuses with `[native:undo-changed-since]` after a later change to a touched row.
  - Write failing tests first, with an edit applied after the save, as a sync would apply it.
- [ ] 1.6 `transaction-form.perf.test.ts` (design D5). Use the stated seed and the five measurements, each with a median under 50 ms. Print the median and p95.
- [ ] 1.7 Allowlists (design D4):
  - add the four names to `native-bridge-allowlist.json` and the Swift client list, with a test that the lists are equal;
  - add the page argument lists in `nativeBridge.ts`, with a test that extra fields are dropped;
  - add the origin-guard names;
  - add a test that `transactions-batch-update`, `transaction-add`, `rules-run` and `payee-create` are refused natively;
  - add four `coverage.json` skips;
  - add Swift decode tests for every fixture.
- [ ] 1.8 Run `yarn typecheck`, `yarn lint`, the tests, `yarn check:mcp-coverage`, the perf suite and `openspec validate --all --strict`. Security reviews the allowlist and the save.

## 2. View model (sc-3602)

- [ ] 2.1 `TransactionFormViewModel` in `NativeBridgeCore` (design D6), tested against the fake transport and the group 1 fixtures. All time-based tests use the injected sleep, never the wall clock. Write failing tests first:
  - add with the preset account;
  - edit loads the tree;
  - one debounced preview per commit (150 ms constant);
  - a newer preview supersedes an older one;
  - a preview timeout keeps the last values and marks the field;
  - Save is enabled only with an error-free preview that matches the draft;
  - the reconciled confirmation is required before `confirmedReconciled: true` is sent, listing every affected account;
  - `changed-since` shows Reload and the changed fields;
  - a save timeout then Retry with the same token;
  - the Undo toast window;
  - no calls in the background, and a re-read on return that keeps the draft;
  - Delete goes through `native/transactions-delete` with the same confirmation.
- [ ] 2.2 `NativeScreen.addTransaction` (design D7):
  - add the switch, the script entry, and the router paths (`/transactions/new`, `/transactions/<id>`);
  - add the `webTransactionAction` chrome message with its closed actions, origin check and live-id check.
  - Write failing tests first on both the Swift and page sides.
  - The switch reads off when unset in this group.
- [ ] 2.3 Run the checks in 1.8 and the `NativeBridgeCore` tests.

## 3. iPhone sheet (sc-3602)

**Before 3.1:** the UX Designer supplies the missing Figma frames:

- payee picker with search, Create and Transfers;
- split editor remainder states;
- amount expression display and keypad accessory;
- inline errors;
- reconciled confirm;
- "changed on another device";
- "Save didn't finish";
- AX5 layouts.

Then:

- [ ] 3.1 The sheet (design D8). Add each new Swift source to `App.xcodeproj` (or the package). The sheet has:
  - the amount with sign and keypad accessory;
  - the payee, category and account pickers;
  - date, notes, cleared;
  - the read-only schedule line;
  - the Documents row (design D7);
  - Save with haptic and the Undo toast;
  - Cancel with the discard confirmation.
  - Verify in the Simulator against the Add and Edit frames (node 25-2), light and dark.
- [ ] 3.2 Splits: add and remove a child, the remainder in words, the `split-limit` state.
- [ ] 3.3 Transfers and category rules: the off-budget and on-budget transfer wording.
- [ ] 3.4 Edit mode:
  - Delete, confirmed;
  - the reconciled dialog;
  - changed on another device, with Reload;
  - "Make recurring" and "Add document" hand-offs that return to the native screen.
- [ ] 3.5 Routing:
  - the Add tab (replace the `openAdd()` shortcut);
  - a native register row tap;
  - page routes;
  - the preset account.
  - Write UI tests for each.
- [ ] 3.6 Hardware keyboard (design D9): typed expressions, the Tab order including splits, typing in the pickers, Cmd-Return, Esc and Cmd-Delete. Write a UI test for the keyboard-only add scenario.
- [ ] 3.7 VoiceOver (labels, values, errors, the remainder announcement, custom actions), Dynamic Type to AX5, Dark Mode, Reduce Motion, localization. The UX Designer reviews against the frames.
- [ ] 3.8 Equal-result test: the spec's same-input scenarios, run through the web form and the native sheet on one seed, compare every stored field.
- [ ] 3.9 Hands-on Simulator pass by the Tester, notes on the story. Then flip `NativeScreen.addTransaction` to on when unset and show the toggle in Settings › Native screens. Write failing tests first. This lands only after the pass.
- [ ] 3.10 Fork news entry for the native Add transaction sheet.

## Follow-ups in other stories

- **sc-5091, attachments:** `native/attachment-add` and the native pickers replace the "Add document" hand-off. A new transaction gets held documents.
- **sc-5092, Mac inspector:** under the Mac app (sc-3629), on these handlers and this view model. Ken's save-as-you-go question is settled there.
- **sc-4617:** the native schedule editor replaces "Make recurring". **sc-4618:** native rules.
- **sc-4643:** the Settings screen edits `payee-picker-max-results` and `transaction-split-max-children`.
- **sc-4877:** extend the Swift-minted nonce to `confirmedReconciled` on the save.

## Workflow follow-up

- Archive when group 3 merges. Then:
  - move the story's change link to the archive path;
  - add the `spec:native-add-transaction` label;
  - add the spec to epic 470's description.
