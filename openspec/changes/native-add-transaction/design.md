# Design

## Facts

Read on origin/development 2645aa42 and in Figma (Accounts page, node 25-2):

- **The web save path:** the web form (`components/mobile/transactions/TransactionEdit.tsx`) saves through `transactions-batch-update {added, updated, deleted, learnCategories}`, not `transaction-add`.
- **Rules in the web form:**
  - For a new transaction only, it calls `rules-run` on every field commit, after grouping splits (`transactionForRulesFromList`).
  - When the payee changes, every field the rules return is applied. Otherwise only empty fields and notes rules are applied (`shouldApplyRuleChange`).
  - A field the user cleared stays empty (`clearedFields`).
  - Editing a saved transaction runs no rules.
- **Amount entry:** a sign toggle (`negate`) and, behind the `mobileCalculator` flag, `evalArithmetic` from `shared/arithmetic`.
- **Schedule:** the web's Schedule button creates a single-time schedule from the transaction (`createSingleTimeScheduleFromTransaction`), and does nothing when it is already linked.
- **Attachments:** held by `usePendingAttachments` and attached after the save.
- **loot-core precedent:** `native/reconcile-adjust` (`server/native/reconcile-lock.ts`) builds a draft, runs `runRules`, writes with `batchUpdateTransactions`, and is one undo step with a Swift token.
  - `accountsWrite` (`server/native/app.ts`) records the state each touched row was left in, so `native/undo` refuses after a later change (native-accounts-screen D3a).
  - The reconcile lock binds a write to what was shown with `plan_digest`.
- **Limits:** the `LIMITS` registry and `readLimit` (`reconcile-lock.ts`). Each limit is a synced preference with a default and a ceiling.
- **Refusal codes:** stable codes in `server/native/fixtures/native-refusal-codes.json`, matched by the Swift side.
- **Native routing:** `NativeTabBarController.openAdd()` routes to the web `/transactions/new` (marked "shortcut"). The native register (native-accounts-screen D5) leaves `/transactions/<id>` to the web.

## D1. Two reads

- **`native/transaction-form {id?, account_id?}`**, read once when the sheet opens. It returns:
  - the currency fields that `native/budget-month` carries;
  - `accounts`, open accounts as `{id, name, offbudget}` in the web's order;
  - `categoryGroups`, the non-hidden groups and categories, income included, as the web picker shows them;
  - `defaults` for add: the account (`account_id`, if open), today's date, and `cleared` from the web's default;
  - for edit, `transaction`, the parent and its children, with:
    - names resolved;
    - `transferAccount` and `reconciled` on each row;
    - `schedule` as `{id, name}` or null;
    - `attachments` as `{id, name}`;
    - `digest`.
  - **The digest** is a SHA-256 over every row a save could touch: the parent, its children, and every transfer partner. Each row contributes its account, date, payee, category, amount, notes, cleared, reconciled, tombstone and sort order. It is computed as the reconcile lock computes `plan_digest`.
  - An `id` that is not a live top-level transaction, or that belongs to a closed account, fails.
- **`native/payees {search}`** returns `{payees: [{id, name, favorite}]}`:
  - favourites first, then by name;
  - transfer payees excluded (they are in `accounts`);
  - search escaped as the register's is (D2 of native-accounts-screen), at most 100 characters;
  - capped by the limit `payee-picker-max-results`: default 50, ceiling 500.

Rejected: payees inside the form read. A budget can have thousands of payees, and the picker searches as the user types.

## D2. Preview

**`native/transaction-preview {draft, changedField, clearedFields}`** returns `{draft, remaining, errors}`.

The draft:

- `{id?, account, date, payee | payeeName, category, notes, cleared, inflow, amountText, splits}`;
- each split is `{id?, payee?, category, notes, inflow, amountText}`.

What it does:

- **Amounts:** loot-core evaluates each `amountText` with `evalArithmetic` in the budget's number format, applies `inflow` for the sign, and returns integer minor units. Swift never parses, adds or rounds money.
- **Remainder:** `remaining` is the parent amount minus the children's sum, so the split editor can show "left to split" and "over".
- **Rules:** for a draft with no `id`, it runs the rules exactly as the web form does:
  - the grouped split;
  - every field re-applied after a payee change;
  - otherwise only empty fields and notes;
  - never a field in `clearedFields`.

  A draft with an `id` runs no rules.
- **Errors:** `errors` maps each field to a code from the closed set in the fixture `transaction-field-errors.json`:
  - `amount-invalid`, `amount-required`;
  - `account-required`, `account-closed`;
  - `category-not-allowed`, `category-unknown`;
  - `date-invalid`;
  - `split-mismatch`, `split-limit`;
  - `payee-too-long`, `notes-too-long`.
- **Writes nothing.**
- **Swift's side:** Swift sends the preview after a field commits, debounced (`TransactionFormViewModel.previewDebounce`, 150 ms, a named constant). A newer preview supersedes an older one.

## D3. Save

**`native/transaction-save {draft, digest, undoToken, confirmedReconciled}`** returns `{id}`. It is one undo step, all or nothing.

Before any write, it computes the full set of rows the save touches:

- the parent;
- its existing and new children, and the children it removes;
- every transfer partner of any of these, old and new.

Then it checks, in order, changing nothing on any refusal:

1. **Undo token:** `undoToken` is required. If a save with this token already landed (found in the undo metadata), it returns that save's `{id}` and writes nothing.
2. **Edit digest:** for an edit, the recomputed digest must equal `digest`. Otherwise it refuses with `[native:changed-since]`, a new fixture code.
3. **Validation:** the draft goes through the preview's checks. Any error refuses with `[native:invalid-draft]`. The rules are:
   - the account is open;
   - the category exists and is not hidden;
   - there is no category on an off-budget account's rows or on a transfer between two on-budget accounts;
   - the children sum to the parent;
   - the children number at most `transaction-split-max-children` (default 50, ceiling 200);
   - notes are at most 10,000 characters;
   - a new payee name is at most 200 characters;
   - the date is a real calendar date.
4. **Reconciled rows:** if any touched row is reconciled, `confirmedReconciled === true` is required, or it refuses with `[native:needs-confirmed-reconciled]`.

Then it writes:

- **New payee:** a new `payeeName` creates the payee in the same undo step.
- **Rules:** for an add, it runs the rules once more on the server, so the stored result equals the web form's even if a rule changed after the last preview.
- **The write:** one `batchUpdateTransactions` with `learnCategories` from the synced preference `learn-categories`.
- **Undo metadata:** it records the state it left for every touched row (the digest's fields), so `native/undo` refuses with `[native:undo-changed-since]` after a later change. This extends `readTouchedState` to those fields.

Swift sends `confirmedReconciled: true` only after the person confirms the native dialog. That dialog names every reconciled row and partner account the save touches.

The page-script risk is the same as native-accounts-screen D3. It is accepted until production hardening; sc-4877's nonce is to cover it.

**Delete** reuses `native/transactions-delete {account_id, ids: [parentId], confirmedReconciled}`. It already takes children and transfer partners, and refuses a reconciled row without confirmation. Its confirmation dialog is the same as the save's.

## D4. Allowlists and the page

- **The new names:** the four new handlers join `native-bridge-allowlist.json` and the Swift client allowlist, with a test that the two lists are equal.
- **The page's argument lists:** `nativeBridge.ts` forwards only the listed fields for each name:
  - form: `id`, `account_id`;
  - payees: `search`;
  - preview: `draft`, `changedField`, `clearedFields`;
  - save: `draft`, `digest`, `undoToken`, `confirmedReconciled`.

  Anything else is dropped before loot-core.
- **Origin guard:** the save and the preview join the origin-guard write names.
- **Raw handlers:** `transactions-batch-update`, `transaction-add`, `rules-run` and `payee-create` stay refused natively, with a test.
- **MCP:** gets `coverage.json` skips; agents already have `write_create_transactions` and `write_update_transactions`.

## D5. Latency gates

`transaction-form.perf.test.ts` runs in Fork CI's "Native perf gates". The seed:

- 5,000 payees, 40 accounts and 150 categories;
- 300 rules, with payee, notes and amount conditions and a split action;
- a 50-child split.

Gates, each with a median under 50 ms on the loot-core side and both median and p95 printed:

- `native/payees` with a two-letter search and with an empty search;
- `native/transaction-preview` for a payee change on a new transaction (rules run);
- the same preview for an amount change on the 50-child split;
- `native/transaction-form` for that split.

## D6. View model

`TransactionFormViewModel` (`NativeBridgeCore`) holds the draft, the last preview and the field errors. It is tested against the fake transport and the contract fixtures.

- **Clock:** the debounce and the undo window use an injected sleep, as `AccountsViewModels` does. The tests never wait on the wall clock.
- **Previews:** a preview that times out keeps the last values and marks the field "not checked". Save stays enabled only when the last preview has no errors and matches the current draft.
- **A save that times out** shows "Save didn't finish" with Retry, as the native-bridge backgrounding rules require. Retry sends the same token and draft. If the first save did land, the retry returns its id and writes nothing (D3), so a retry never adds the transaction twice.
- **Background:** no calls while the app is in the background. On returning, an open edit sheet re-reads the form and keeps the user's draft.

## D7. Route and switch

- **The switch:** `NativeScreen.addTransaction` in UserDefaults, with an entry in the `NativeScreensScript` and a toggle in web Settings › Native screens.
- **Default:** it reads off while unset, until the Simulator pass in task 3.9. That task flips the default to on (Ken, 2026-11-15) and shows the toggle. Native Settings (sc-4300) shows it later.
- **While on:**
  - the Add tab presents the native sheet, with the account preset when a native register is on screen;
  - a native register row's tap opens the edit sheet;
  - a page route to `/transactions/new` or `/transactions/<id>` opens the sheet over the current screen, not the web form.
- **While off:** everything is the web form, exactly as today.
- **Hand-offs:** "Make recurring" and "Add document" send the chrome message `webTransactionAction {action, transaction_id}`.
  - `action` is `make-recurring` or `documents`.
  - The page opens the web editor for that saved transaction. The chrome checks the origin, the closed action set, and that the id is a live transaction.
  - These hand-offs are temporary: sc-4617 and sc-5091 replace them.

## D8. Screen (iPhone)

A sheet with large detents, following the Figma Add and Edit frames.

- **Amount:** first, focused on open, with the sign shown as Outflow or Inflow.
  - The decimal keypad gains an accessory row with + − × ÷ and the sign toggle.
  - The field shows the expression while editing and the evaluated amount from the preview after it.
- **Payee picker:** search, favourites, a "Create “…”" row, and a Transfers section listing open accounts other than the current one.
- **Category picker:**
  - groups from the form read;
  - hidden for an off-budget account and for an on-budget to on-budget transfer, with the reason in words.
- **Other fields:**
  - account, date (the system picker);
  - notes (multiline, transaction-notes);
  - cleared (a toggle);
  - a schedule line, read-only, when linked;
  - documents (D7).
- **Split:**
  - each child has its amount, category, payee and notes;
  - the remaining amount comes from the preview, in words ("$12.00 left to split", "$3.00 over"), never colour alone.
- **Save:** Save in the toolbar, with a success haptic and the sheet closing. An Undo toast follows for the undo window, through `native/undo`.
- **Cancel:** asks first when the draft has changes. Edit mode adds Delete (destructive, confirmed).
- **Errors:** shown inline under each field. `changed-since` shows "This transaction changed on another device" with Reload. Reload keeps nothing silently: it shows what changed.

## D9. Keyboard and accessibility

These are requirements, not polish.

- **Hardware keyboard:**
  - In the amount field, the digits, `+ - * /`, the decimal separator and Backspace work. Return evaluates.
  - Tab and Shift-Tab move amount → payee → category → account → date → notes → cleared → Save. Inside splits, Tab moves through each child's fields in order.
  - In the pickers, typing filters, the arrows move and Return chooses.
  - Cmd-Return saves, Esc cancels (asking first when changed), and Cmd-Delete deletes in edit mode (confirmed).
- **VoiceOver:**
  - every field reads its label, value and error;
  - the amount reads as currency with its direction;
  - the remainder is announced when it changes;
  - split children are grouped as "Split 2 of 4";
  - Delete and Remove split are custom actions.
- **Dynamic Type to AX5:** labels stack above values, and the amount never truncates.
- **Theme:** Dark Mode through the HE colour variables, tabular digits, and all text localized.

## D10. Mac

The Mac right-side inspector is sc-5092, under the Mac app (sc-3629). It uses these handlers and `TransactionFormViewModel`, so the Mac adds views and commands only.

Ken's open question (save as you go, or a Save button) is decided there. Save as you go would send `native/transaction-save` per field commit with the same digest rule, so no handler changes either way.

## Risks

- **Rules round trip:** every field commit is one bridge call when rules run. The perf gate and the debounce cover it. A slow preview never blocks typing.
- **Digest scope:** a sync that changes only a transfer partner refuses an edit. This is deliberate: the save would overwrite it.
- **Hand-offs:** "Make recurring" and adding documents leave the native sheet until sc-4617 and sc-5091.
- **Accepted:** page script can pass `confirmedReconciled` (D3), as in native-accounts-screen.

## Decisions for Ken

None in this change. Mac save as you go or a Save button belongs to sc-5092.
