# Design

## Facts

Read on origin/development 2645aa42 and in Figma (Accounts page, node 25-2).

**The web form** (`components/mobile/transactions/TransactionEdit.tsx`):

- It saves through `transactions-batch-update {added, updated, deleted, learnCategories}`, not `transaction-add`.
- For a new transaction only, it calls `rules-run` on every field commit, with splits grouped first (`transactionForRulesFromList`).
  - A payee change applies every field the rules return.
  - Any other change fills only empty fields and notes (`shouldApplyRuleChange`).
  - A field the user cleared stays empty (`clearedFields`).
  - Editing a saved transaction runs no rules.
- Amount entry has a sign toggle (`negate`). Behind the `mobileCalculator` flag, it evaluates arithmetic with `evalArithmetic` from `shared/arithmetic`.
- Schedule creates a single-time schedule from the transaction (`createSingleTimeScheduleFromTransaction`).
- Attachments are held by `usePendingAttachments` and attached after the save.

**loot-core precedents:**

- `native/reconcile-adjust` (`server/native/reconcile-lock.ts`) builds a draft, runs `runRules`, writes with `batchUpdateTransactions`, and is one undo step with a Swift token.
- `readTouchedState` (`server/native/accounts-writes.ts`) reads each touched row's category, tombstone, reconciled, cleared, notes, amount, payee, account, date, transfer link and schedule. `changedSince` compares that state for `native/undo` (native-accounts-screen D3a).
- The undo history (`MESSAGE_HISTORY`, `server/undo.ts`) lives in memory only, is trimmed, and is reset when a budget loads. Anything that must survive a reload cannot live there.
- **Limits:** `LIMITS` and `readLimit` (`reconcile-lock.ts`). Each limit is a synced preference with a default and a ceiling.
- **Refusal codes:** stable codes in `server/native/fixtures/native-refusal-codes.json`, matched by the Swift side.
- `native/transactions-delete` treats a row as reconciled only by its own flag. A child whose split parent is reconciled is not caught (Security, #416 finding C).

**Native routing:** `NativeTabBarController.openAdd()` routes to the web `/transactions/new` and is marked "shortcut". The native register (native-accounts-screen D5) leaves `/transactions/<id>` to the web.

## D1. Two reads and one shared state reader

### `native/transaction-form {id?, account_id?}`

It returns:

- the currency fields `native/budget-month` carries;
- `accounts`: open accounts as `{id, name, offbudget, transferPayee}`, in the web's order. `transferPayee` is the account's transfer payee id, which the Transfer state and the payee picker's Transfers section put in the draft. It was added for the 2026-11-18 design decisions (D8a), as an additive field;
- `categoryGroups`: the non-hidden groups and categories, as the web picker shows them;
- `defaults` for an add: the account (`account_id` if open), today, and the web's `cleared` default;
- for an edit, `transaction`: the parent and children with names resolved, `transferAccount`, `transferAccountClosed` and `reconciled` on each row, `schedule {id, name}` or null, attachment names, and `digest`.

An `id` that is not a live top-level transaction, or that belongs to a closed account, fails with `[native:not-found]`. The sheet then shows "This transaction is no longer available" (D8).

### One state reader for the digest and for undo

`readTouchedState(touched)` stays the only reader of row state.

- This change adds `parent_id`, `is_parent`, `is_child` and `sort_order` to its transaction columns. The addition is additive: the accounts writes keep passing their tests.
- **The digest** is the SHA-256 of `readTouchedState` over the touched set. The touched set is the parent, its children, and every transfer partner of any of them, with ids sorted.
- **The undo metadata** of a save stores the same state.
- The digest therefore covers the row ids, `parent_id`, the transfer link and the schedule. A child added on another device, or a relinked transfer, changes it.

### `native/payees {search}`

It returns `{payees: [{id, name, favorite}]}`, and only those fields:

- live payees only (no tombstoned);
- favourites first, then by name;
- transfer payees excluded (they are in `accounts`);
- the search uses a bound LIKE with `%`, `_` and `\` escaped.

Two limits apply, both through `readLimit`:

- The search text is at most `payee-search-max-length` characters (default 100, ceiling 200). Longer text fails the call.
- Results are capped by `payee-picker-max-results` (default 50, ceiling 500).

## D2. The draft and the preview

### The draft is a trust boundary

The page forwards `draft` as one object, so loot-core accepts only these keys and types, and refuses anything else with `[native:invalid-draft]`:

| Key | Type |
| --- | --- |
| `newId` | lowercase UUID (8-4-4-4-12 hex), add only (D3) |
| `id` | string, edit only |
| `account` | string |
| `date` | string `YYYY-MM-DD` |
| `payee` | string id or null |
| `payeeName` | string or null |
| `category` | string or null |
| `notes` | string |
| `cleared` | boolean |
| `inflow` | boolean |
| `amountText` | string |
| `splits` | array of `{id?, payee?, category, notes, inflow, amountText}` |
| `userFields` | array of field names, from the closed list below |

Keys such as `reconciled`, `imported_id` and `tombstone` never reach `batchUpdateTransactions`.

**`userFields`** names each field the person set or cleared by hand after a rule touched it (D2a). It replaces the web's `clearedFields`. Allowed names: `account`, `date`, `payee`, `category`, `notes`, `cleared`, `amount`, `splits`.

### `native/transaction-preview {draft, changedField}`

It returns `{draft, ruleFields, replaced, remaining, errors}` and writes nothing. It never creates a payee.

- **Amounts.** loot-core evaluates each `amountText` with `evalArithmetic` in the budget's number format, applies `inflow`, and returns integer minor units. Swift never parses, adds or rounds money.
  - Amount text longer than 100 characters is `amount-invalid`.
  - So is a result that is not finite, not a whole number of minor units, or larger in magnitude than `Number.MAX_SAFE_INTEGER`.
  - The 100-character bound is input validation, not a tunable limit: no amount needs more.
- **Rules.** For a draft with no `id`, rules run as on the web:
  - a payee change applies every field the rules set;
  - any other change fills only empty fields and notes;
  - a field in `userFields` is never changed, except that a payee change may replace it (web parity), and then it is listed in `replaced` with its previous value.
  - `ruleFields` lists every field whose value currently comes from a rule.
  - A draft with an `id` runs no rules.
- **The split remainder.** `remaining` is the parent minus the children's sum.
- **Errors.** `errors` maps each field (with a child index for splits) to a code from `transaction-field-errors.json`:
  - `amount-invalid`, `amount-required`;
  - `account-required`, `account-closed` (the transaction's account, or a transfer payee's account that is closed or deleted);
  - `category-not-allowed`, `category-unknown`;
  - `date-invalid`: not a real date, or outside 1900-01-01 to 2999-12-31. A future date is allowed.
  - `split-mismatch`, `split-limit`;
  - `payee-too-long`, `notes-too-long`.

**Why a second fixture.** The field codes describe one field each, so they live in their own fixture beside `native-refusal-codes.json`, which holds call refusals. A test checks that the two files share no code. Rejected: one merged list, which would let Swift mistake a field code for a call refusal.

**Debounce.** Swift sends the preview after a field commits, debounced by the named constant `TransactionFormViewModel.previewDebounce` (150 ms). A newer preview supersedes an older one.

### D2a. Rules the person can see and undo

- Each field in `ruleFields` shows "Set by a rule" in words, and VoiceOver reads it with the field.
- The person's own edit to such a field adds it to `userFields`. Their value is then kept until the next payee change.
- When a payee change replaces fields in `userFields`, the sheet names them ("Category and notes were changed by a rule") with Restore. Restore puts back the previous values from `replaced`, keeps them in `userFields`, and is announced to VoiceOver.

## D3. Save

`native/transaction-save {draft, digest, undoToken, confirmedReconciled}` returns `{id}`. It is one undo step, and all or nothing.

### Add or edit

- An **add** carries `newId`, a UUID that Swift creates when the sheet opens and keeps across retries. No `id` and no `digest`.
- An **edit** carries `id` and the form's `digest`.

### Order of work

Every step refuses with no write.

1. **Shape.** The draft has the keys and types of D2, and `undoToken` is present. Otherwise `[native:invalid-draft]`.
2. **Repeat of an add.** `newId` must be a lowercase UUID, or the save refuses with `[native:invalid-draft]`. The hand-off's `[A-Za-z0-9_-]+` check therefore always accepts the person's own transaction. A row with id `newId` may already exist:
   - **Live, top-level and in the draft's account**, with the same date, amount, payee, category and child count as the draft evaluates to: return `{id: newId}` and write nothing.
   - **Live, but a split child, in another account, or different:** `[native:invalid-draft]`, with no id returned.
   - **Tombstoned** (the save was undone or deleted): `[native:changed-since]`, with no id returned.

   The row itself is the durable record, so a reload, an engine restart or a trimmed undo history cannot cause a second save. Nothing else is kept, so no retention setting is needed.
3. **Edit digest.** An edit without `digest`, or with one that no longer equals the recomputed digest, refuses with `[native:changed-since]`.
4. **Rules, for an add only.** The rules run on the server first, with `userFields` honoured as in D2. If the result differs in any field from the draft as submitted, the save refuses with `[native:preview-stale]`. The view model then previews again and shows the person the change. A save therefore stores exactly the draft the person last saw.
5. **Touched set.** It is computed on the draft as it now stands: the parent, its children (added, kept and removed), and every transfer partner, old and new.
6. **Validation** with the preview's checks: an open account and open transfer accounts; the category rules; children summing to the parent; the children cap; amount, notes, date and payee-name bounds. Any failure refuses with `[native:invalid-draft:<codes>]`, where `<codes>` holds only field codes from the fixture, never text the person typed.
7. **Reconciled rows.** A touched row counts as reconciled when it, or the split parent of a touched child, is reconciled. Any such row needs `confirmedReconciled === true`, or the save refuses with `[native:needs-confirmed-reconciled]`.

### Then it writes

- **Payee.** `payeeName`, trimmed, must be non-empty and within `payee-name-max-length` (default 200, ceiling 500).
  - A name equal, ignoring case, to a live payee uses that payee.
  - A name equal to an account's transfer payee creates nothing and is `[native:invalid-draft]`.
  - Otherwise the payee is created in the same undo step.
- **Notes** are at most `transaction-notes-max-length` (default 10,000, ceiling 50,000) on every row, children included.
- **Write.** One `batchUpdateTransactions`, with `learnCategories` from the synced `learn-categories`.
- **Undo metadata** stores `readTouchedState` of the touched set, so `native/undo` refuses with `[native:undo-changed-since]` after a later change.

Swift sends `confirmedReconciled: true` only after the person confirms the native dialog, which names every reconciled row's account. The page-script risk is as in native-accounts-screen D3: accepted until sc-4877's nonce covers it.

### Delete

Delete reuses `native/transactions-delete {account_id, ids: [parentId], confirmedReconciled}`. This change adds the reconciled-parent rule of step 7 to it.

Its native confirmation:

- names the transfer partner's account, and says when that account is closed (decision on sc-5013);
- says both sides are deleted;
- says Undo restores both.

### Limits

All are in the `LIMITS` registry and read through `readLimit`. Malformed values use the default. sc-4643's Settings makes them editable.

| Limit | Default | Ceiling |
| --- | --- | --- |
| `payee-picker-max-results` | 50 | 500 |
| `payee-search-max-length` | 100 | 200 |
| `payee-name-max-length` | 200 | 500 |
| `transaction-notes-max-length` | 10,000 | 50,000 |
| `transaction-split-max-children` | 50 | 200 |

## D4. Allowlists and the page

- **The four new names** join `native-bridge-allowlist.json` and the Swift client allowlist, with a test that the two lists are equal.
- **The page's argument lists.** `nativeBridge.ts` forwards only the listed fields, and drops anything else before loot-core:
  - form: `id`, `account_id`;
  - payees: `search`;
  - preview: `draft`, `changedField`;
  - save: `draft`, `digest`, `undoToken`, `confirmedReconciled`.
- **Origin guard.** The save and the preview join the origin-guard write names.
- **Raw handlers stay refused natively, with a test:** `transactions-batch-update`, `transaction-add`, `rules-run` and `payee-create`.
- **New refusal codes.** `changed-since`, `preview-stale` and `not-found` join the shared `native-refusal-codes.json`, with the fixture tests both sides already run.

## D5. Latency gates

`transaction-form.perf.test.ts` runs in Fork CI's "Native perf gates".

**Seed:** 5,000 payees, 40 accounts, 150 categories, 300 rules (with payee, notes and amount conditions and a split action) and a 50-child split.

**Measured,** each with median and p95 printed, and the median gated under 50 ms:

- `native/payees` with a two-letter search, and with an empty one;
- a payee-change preview on a new transaction;
- an amount-change preview on the split;
- the form read of the split;
- a save of a new transaction (rules run).

If the rules cases cannot meet 50 ms on this seed, stop and report the measured numbers to the Director before changing the design, as ADR 11's gate did.

## D6. View model

`TransactionFormViewModel` (`NativeBridgeCore`) is tested against the fake transport and the contract fixtures, with an injected sleep for every time-based case.

- **Draft state.** It keeps `newId` for the sheet's lifetime, along with `userFields`, `ruleFields` and the last preview.
- **Save enabled.** Save is disabled while the last completed preview reported an error for the current values. Otherwise it is enabled, including while a field is unchecked (D8c): the save re-runs rules and validation on the server and refuses with `[native:preview-stale]` or `[native:invalid-draft:<codes>]` if the draft was wrong.
- **Preview timeout (D8c).** After a preview times out, the view model retries it once by itself after a short pause (`previewRetryDelay`, 2 s, a named constant) and once more when the app returns to the foreground. If it still has no answer, the field shows "Couldn't check this yet." with Check Again.
- **Reload after `changed-since` (D8b).** The view model keeps the form read it started from (the base), re-reads the form, and compares each field of the new read with the base and with the draft. This is a value comparison of fields the engine returned, amounts compared as integers; no arithmetic is done.
  - A field the person did not change takes the new value.
  - A field only the person changed keeps their value.
  - A field changed both by the person and elsewhere keeps the person's value and is listed with both values and "Use theirs".
  - The draft then carries the new digest, and the new read becomes the base.
- **Save timeout.** The sheet shows "Save didn't finish" with Retry. Retry sends the same `newId`, token and draft.
  - For an add, D3 step 2 makes the retry safe.
  - For an edit that did land, the retry gets `changed-since`. The view model re-reads, and if the stored values equal the draft it treats the save as done.
- **`preview-stale`.** It shows "Rules changed this; check and save again.", previews again, and shows what the rule changed (D2a).
- **Background.** No calls while the app is in the background. On return, an open edit sheet re-reads and keeps the draft.

## D7. Route, switch and hand-offs

- **The switch.** `NativeScreen.addTransaction` in UserDefaults, with a `NativeScreensScript` entry and a toggle in web Settings › Native screens.
  - It reads off while unset until the Simulator pass in task 3.9.
  - That task flips the default to on (Ken, 2026-11-15) and shows the toggle.
- **While the switch is on:**
  - the Add tab presents the sheet, with the account preset from a native register on screen;
  - a native register row opens the edit sheet;
  - a page route to `/transactions/new` or `/transactions/<id>` opens the sheet over the current screen.
- **While it is off:** the web form, exactly as today.
- **Hand-offs.** "Make recurring" and "Add document" send `webTransactionAction {action, transaction_id}`.
  - Swift sends only a saved, live id taken from the form read.
  - The page checks again that `action` is `make-recurring` or `documents`.
  - The page accepts only an id matching `[A-Za-z0-9_-]+` that is a live transaction, and `encodeURIComponent`s it into the path (the `..` lesson from #423). Anything else is ignored.
  - These hand-offs are temporary: sc-4617 and sc-5091 replace them.

## D8. Screen (iPhone)

A sheet with large detents, following the Figma Add and Edit frames.

- **Amount.**
  - It comes first and is focused on open.
  - Above it, a three-way control: Expense, Income, Transfer (D8a). Expense stores an outflow and Income an inflow.
  - The keypad accessory has + − × ÷.
  - The field shows the expression while editing and the evaluated amount after the preview.
- **Payee picker.** Search, favourites, "Create “…”", and Transfers (open accounts other than the current one).
- **Category picker (D8d).**
  - It lists the groups and their categories from the form read, with search that filters by name.
  - Uncategorized is the first row; choosing it stores no category.
  - The current choice is ticked, matched by id.
  - Hidden categories are not listed, as on the web.
  - The category row is disabled, with its reason in words, for an off-budget account and for a transfer between two on-budget accounts.
  - When a `categories` change event arrives, the view model re-reads the form. If that read fails, the picker shows an error with Retry and keeps the last list.
- **Other fields.** Account, date, notes (multiline), cleared, a read-only schedule line, and the Documents row (D7).
- **Rule indicator.** "Set by a rule" on rule-filled fields, and the replaced-fields notice with Restore (D2a).
- **Splits.** Each child has amount, category, payee and notes. The remainder shows in words ("$12.00 left to split", "$3.00 over").
- **Saving and leaving.**
  - Save gives a success haptic, closes the sheet, and shows an Undo toast. If the undo is refused, the toast reads "Can't undo — changed since".
  - Cancel asks first when the draft has changes.
  - Edit mode adds Delete, which asks first (D3).
- **States.**
  - Loading while the form reads, redacted.
  - Form-read failure: "This transaction is no longer available" with Close.
  - Field errors inline.
  - `changed-since` shows "This transaction changed on another device" with Reload. Reload keeps the person's edits (D8b).
  - Text: every string comes from the Designer's copy table once the Product Owner has approved it, as translated strings (D8e). Wording quoted in this design and its spec is illustrative until then.

### D8a. Transfer state

- Choosing Transfer replaces the Payee row with a "To account" row, listing open accounts other than this one. A direction control says whether the money goes out of this account or into it, and that sets `inflow`.
- The engine still stores a transfer through the destination account's transfer payee. The draft's `payee` is that account's `transferPayee`, and the payee picker's Transfers section stays.
- **Category:**
  - Between two on-budget accounts, or two off-budget accounts, the Category row is hidden, with the reason in words.
  - Between an on-budget and an off-budget account, the Category row shows only when this transaction is on the on-budget side. On the off-budget side it is hidden, with the reason.
- **Switching modes:**
  - Switching from Transfer back to Expense or Income clears the To account and restores the Payee row.
  - Choosing a transfer payee in the payee picker switches the control to Transfer.

### D8b. Reload keeps the person's edits

See D6. The engine needs nothing new: the form read already returns every field, and the view model compares values.

### D8c. Unchecked fields

See D6. While a field is unchecked, the save stays protected by the server's own rules run and validation (D3 steps 4 to 6).

### D8d. Category picker

See D8, Category picker. It uses only the form read's `categoryGroups` and the `categories` change event.

### D8e. Copy

- The Designer's copy table (frame, element, text), approved by the Product Owner in one pass, is the source of exact text.
- The text is plain language: one sentence of cause and one of what to do, with no jargon, codes or blame.
- Every string is a localized string. A test fails on a hard-coded user-facing string in the sheet.

## D9. Keyboard and accessibility

These are requirements, not polish.

- **Hardware keyboard.**
  - In the amount field: digits, `+ - * /`, the decimal separator and Backspace. Return evaluates.
  - Tab and Shift-Tab move: amount → payee → category → account → date → notes → cleared → Save. Inside splits, through each child in order.
  - Pickers: typing filters, the arrows move, Return chooses.
  - Cmd-Return saves. Esc cancels, asking first when there are changes. Cmd-Delete deletes, with confirmation.
- **VoiceOver.**
  - Each field reads its label, its value, "Set by a rule" when that applies, and any error.
  - The amount reads as currency with its direction.
  - The remainder, replaced fields and Restore are announced.
  - Split children are grouped as "Split 2 of 4".
- **Dynamic Type to AX5.** Labels stack above values, and the amount never truncates.
- **Appearance and language.** Dark Mode through the HE variables, tabular digits, and localized text.

## D10. Mac

The Mac right-side inspector is sc-5092, under sc-3629. It uses these handlers and `TransactionFormViewModel`. Ken's open question (save as you go, or a Save button) is settled there. Save as you go would send a save per field commit with the same digest rule, so no handler changes either way.

## Risks

- **Rule latency.** Every field commit makes one rules round trip. It is covered by the gate and the debounce, and a slow preview never blocks typing.
- **Digest scope.** A sync that changes only a transfer partner refuses an edit. This is deliberate.
- **`preview-stale`.** A rule edited on another device between the preview and the save refuses the save once. The re-preview shows why.
- **Hand-offs.** "Make recurring" and documents leave the native sheet until sc-4617 and sc-5091.
- **Accepted:** page script can pass `confirmedReconciled` (D3).

## Decisions for Ken

None in this change. The Mac save model belongs to sc-5092.
