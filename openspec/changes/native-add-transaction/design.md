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
- `categoryGroups`: the groups and their categories, each category carrying `hidden` (changed 2026-11-18, story comment 5150: the picker needs hidden categories so that an edit can keep one);
- `defaults` for an add: the account (`account_id` if open), today, and the web's `cleared` default;
- for an edit, `transaction`: the parent and children, each row as `{id, account, date, payee, category, notes, cleared, amount, reconciled}` with names resolved and `amount` in integer minor units, plus:
  - `transferAccount` and `transferAccountClosed` on each transfer row;
  - `partner`, the transfer partner's own `{id, account, date, amount, notes, cleared, reconciled}`, so Reload can show a change made only on the other side (D6; added 2026-11-18, additive);
  - `schedule {id, name}` or null;
  - attachment names;
  - `digest`.

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

**The draft is the person's input,** never a rule's output (amended 2026-11-18, PR #453). It holds what the person typed or chose, plus the preset account, and nothing a rule produced. The view model sends the same input to the preview and to the save, and shows the preview's result beside it. The rules therefore always run once, on the same input, in the preview and in the save.

**`userFields`** names every field the person has set or cleared by hand in this sheet, whether or not a rule had touched it, plus the preset account (D2a). Rules never change a field in `userFields`: not in the preview, not on a payee change, not at the save. It replaces the web's `clearedFields`. Allowed names: `account`, `date`, `payee`, `category`, `notes`, `cleared`, `amount`, `splits`. Defaults the sheet fills in (today's date, the cleared default) are not in it.

The view model adds a field when the person edits or clears it. It removes a field only when the person taps "Use rule's value" for it (D2a).

### `native/transaction-preview {draft, changedField}`

`changedField` is kept in the shape but no longer changes how the rules run (PR #453). The rules always run on the whole input.

It returns `{result, resultDigest, ruleFields, suggestions, remaining, errors}` and has no side effects. It writes to no table, creates no payee, and makes no undo step (amended 2026-11-18 after the review of PR #447).

- **`result`** is the input after one run of the rules, in the draft's shape, with amounts evaluated.
- **`resultDigest`** is a SHA-256 over `result`'s rule-settable fields on every row: account, date, payee or payee name, category, notes, cleared and amount. Swift treats it as opaque.
- **`ruleFields`** lists the fields of `result` that a rule set (the input left them empty or defaulted). The sheet marks them "Set by a rule".
- **`suggestions`** lists `{field, row, value}` for each field in `userFields` that the rules would set to a different value. `value` is the rule's value, as the engine shows it: a category id and name, a payee id or name, notes text, or an amount in minor units. It replaces the earlier `replaced` and `overridden` (PR #453).

- **Payee names.** The rules run with payee names left unresolved. This is the change's only upstream edit:
  - in `packages/loot-core/src/server/transactions/transaction-rules.ts`, `runRules` gets one optional parameter (`{ resolvePayeeNames: false }`);
  - `resolvePayeeNameForRules` gets one branch around its `insertPayee` call (near line 1291), so a rule action that sets a payee by name creates nothing when the option is false;
  - the default, `rules-run` and every other caller are unchanged.
  - The preview maps such a name to a live payee with the same name, ignoring case, or returns it as `payeeName`.
  - The save resolves or creates it under D3's payee rules, inside its own undo step.
  - This holds for the second rules run that `ruleFields` needs, too.
- **Split count first.** Before evaluating any child, the preview and the save compare the number of `splits` with `transaction-split-max-children`, which is never above its ceiling of 200. Over it, the preview reports only `split-limit`, and the save refuses with `[native:invalid-draft:split-limit]`. No child is evaluated and no id is looked up.
- **Amounts.** loot-core reads each `amountText` with the grammar below, which follows the budget's number format (`getNumberFormat`). It accepts the text only when the grammar consumes all of it, evaluates the operators, applies the sign from the control (D8a), and returns integer minor units. Swift never parses, adds or rounds money.

  **Before parsing:**
  - Whitespace at the start and end is dropped.
  - `×` (U+00D7) reads as `*`, `÷` (U+00F7) as `/`, and `−` (U+2212) as `-`.
  - One currency symbol (`\p{Sc}`, such as `$` or `€`), directly before or after a number with optional space, is ignored, as the web ignores it.

  **Numbers, by the budget's format.** Grouping separators may appear only between digits of the integer part, at the format's group positions. A number may start with the decimal separator (`.5`) or end with it (`12.`, or `12,` in a comma-decimal format), meaning no fraction digits, as the web's `currencyToAmount` reads them. This holds in both the preview and the save (amended 2026-11-18 after PR #451). A trailing grouping separator is still refused (`12,` in `comma-dot`). The preview runs on a field commit, not on every keystroke, so a half-typed amount never flashes an error.

  | Format | Grouping | Decimal | Groups |
  | --- | --- | --- | --- |
  | `comma-dot` | `,` | `.` | 3 digits (`1,234.56`) |
  | `dot-comma` | `.` | `,` | 3 digits (`1.234,56`) |
  | `space-comma` | space, NBSP or U+202F, interchangeably | `,` | 3 digits (`1 234,56`) |
  | `apostrophe-dot` | `'` or U+2019, interchangeably | `.` | 3 digits (`1'234.56`, `1’234.56`) |
  | `comma-dot-in` | `,` | `.` | last group 3, others 2 (`1,00,000.50`) |

  **Spaces.** In `space-comma`, a space between two digits is grouping, and must sit at a group position: `1 234,56` is accepted, `12 34` is not. In every other format, a space between two digits is refused (`12 34`). Spaces next to an operator or a parenthesis only separate tokens (`1 000 + 2`).

  **Operators.** `+ - * /` between two operands, and parentheses.
  - No sign before a number or a parenthesis.
  - A leading `-` or `−` is `amount-negative`, so the message can point to Expense and Income.
  - A leading `+` is `amount-invalid`, as the web refuses it too.

  **Refused as `amount-invalid`:** anything else, including:
  - `1e20`, `0x10`, `1_000`, `^`, letters, and a second decimal separator (`1..5`);
  - a misplaced group (`12,34` in `comma-dot`, `1,000,00` in `comma-dot-in`);
  - another format's separators (`1,234.56` in `dot-comma`);
  - a trailing operator;
  - a currency symbol anywhere but next to a number;
  - text longer than 100 characters, which is input validation, not a tunable limit;
  - a result that is not finite, not whole minor units, or beyond `Number.MAX_SAFE_INTEGER` in magnitude.

  A result below zero (`3-8`) is `amount-negative`. Zero is allowed, as on the web.

  **Deliberate differences from the web.** The web's `evalArithmetic` strips all whitespace, accepts `^` and a unary minus, and lets `currencyToAmount` guess whether a lone `,` or `.` is decimal or grouping. That lets the text's sign flip the direction. The native engine follows the format exactly and takes the sign only from the control, so no amount is silently regrouped, truncated or reversed.

  **The keypad.** Its decimal key types the budget's decimal separator, not the phone locale's. Its accessory row types `+ − × ÷`, and the engine maps them. Swift only inserts characters.
- **Rules.** For a draft with no `id`, the rules run once on the input. They fill every field not in `userFields`, and leave every field in `userFields` as the person set it. A draft with an `id` runs no rules.
  - **Deliberate difference from the web.** The web re-applies every field on a payee change, replacing a hand-set field. Here a hand-set field stays, and the rule's value is offered as a suggestion (Product Owner, PR #453).
  - A suggestion is computed by running the rules as if that one field were not in `userFields`, keeping its current value. Taking it therefore yields exactly the suggested value.
- **The split remainder.** `remaining` is the parent minus the children's sum.
- **Errors.** `errors` maps each field (with a child index for splits) to `{code, detail?}`.
  - `code` comes from `transaction-field-errors.json`.
  - `detail` is present only for `amount-invalid`: `{decimalSeparator}`, `"."` or `","`, taken from the budget's number format (`.` for `comma-dot`, `apostrophe-dot` and `comma-dot-in`; `,` for `dot-comma` and `space-comma`). It is never text the person typed (added 2026-11-18, story 3602 PR #450).
  - The screen builds the message from a translated string with that separator and an example in the same format ("Use . for decimals, like 12.50"). `amount-negative`'s message tells the person to choose Expense or Income.
  - A save refusal still carries codes only (`[native:invalid-draft:amount-invalid]`). The view model then previews once more to get the detail.

  The codes:
  - `amount-invalid`, `amount-required`;
  - `amount-negative`: a leading minus sign, or a result below zero. The message, from the copy table, says in plain words to choose Expense or Income instead (added 2026-11-18);
  - `account-required`, `account-closed` (the transaction's account, or a transfer payee's account that is closed or deleted);
  - `transfer-same-account`: a transfer payee of the transaction's own account (added 2026-11-18, as the web refuses it);
  - `category-not-allowed`, `category-unknown`;
  - `category-hidden`: a hidden category on a new row, or on a row whose stored category is a different one. An edited row may keep the hidden category it already has (added 2026-11-18);
  - `date-invalid`: not a real date, or outside 1900-01-01 to 2999-12-31. A future date is allowed.
  - `split-mismatch`, `split-limit`;
  - `payee-too-long`, `notes-too-long`.

**Why a second fixture.** The field codes describe one field each, so they live in their own fixture beside `native-refusal-codes.json`, which holds call refusals. A test checks that the two files share no code. Rejected: one merged list, which would let Swift mistake a field code for a call refusal.

**Debounce.** Swift sends the preview after a field commits, debounced by the named constant `TransactionFormViewModel.previewDebounce` (150 ms). A newer preview supersedes an older one.

### D2a. Rules the person can see and choose

- **Set by a rule.** A field in `ruleFields`, which the person has not touched, shows "Set by a rule" in words, and VoiceOver reads it with the field.
- **Editing it.** The person's edit to such a field adds the field to `userFields`, and their value stays from then on.
- **Suggestions.** For each suggestion, the sheet shows under the field "The rule for {payee} would set {Field} to {value}." with a "Use rule's value" button. VoiceOver announces the line when it appears.
- **Use rule's value.** Tapping it removes the field from `userFields` and previews again. The rule then sets the field, and it shows "Set by a rule".
- **Copy.** The exact text comes from the copy table.

## D3. Save

`native/transaction-save {draft, previewDigest, digest, undoToken, confirmedReconciled}` returns `{id}`. It is one undo step, and all or nothing. For an add, `draft` is the same input the last preview received, and `previewDigest` is that preview's `resultDigest` (null while the preview is unchecked).

### Add or edit

- An **add** carries `newId`, a UUID that Swift creates when the sheet opens and keeps across retries. No `id` and no `digest`.
- An **edit** carries `id` and the form's `digest`.

### Order of work

Every step refuses with no write.

1. **Shape.** The draft has the keys and types of D2, and `undoToken` is present. Otherwise `[native:invalid-draft]`.
2. **Repeat of an add.** `newId` must be a lowercase UUID, or the save refuses with `[native:invalid-draft]`. The hand-off's `[A-Za-z0-9_-]+` check therefore always accepts the person's own transaction. A row with id `newId` may already exist:
   - **Live, top-level and in the draft's account**, with the same date, amount, payee, category and child count as the draft's result (step 4): return `{id: newId}` and write nothing.
   - **Live, but a split child, in another account, or different:** `[native:invalid-draft]`, with no id returned.
   - **Tombstoned** (the save was undone or deleted): `[native:changed-since]`, with no id returned.

   The row itself is the durable record, so a reload, an engine restart or a trimmed undo history cannot cause a second save. Nothing else is kept, so no retention setting is needed.
3. **Edit digest.** An edit without `digest`, or with one that no longer equals the recomputed digest, refuses with `[native:changed-since]`.
4. **Rules, for an add only.** The engine computes the result exactly as the preview does: it evaluates the amounts, then runs the rules once on the input, keeping every field in `userFields`.
   - **With a `previewDigest`:** the result's digest must equal it.
   - **Without one** (the preview was unchecked): the result must equal the evaluated input over the rule-settable fields. In other words, no rule changed anything, because the person saw only their own input.
   - **Otherwise** the save refuses with `[native:preview-stale]` before anything is written. The view model then previews the same input and shows the result with "Rules changed this; check and save again."
   - **If it passes,** the result is what is validated and stored.

   **Termination, with no idempotency assumption.** The rules run exactly once per call, on the same input, so the result changes only when the rules or budget data change. That includes a non-idempotent rule such as append-notes, which appends once to the person's notes in the preview and once in the save, giving the same text.
   - A save after an answered preview therefore stores, unless something changed since that preview.
   - A save after an unchecked preview stores at the latest on the second attempt: the refusal brings a preview, and the next save carries its digest.
   - Any further refusal comes from a real change, and shows its new result.
   - Nothing retries automatically: each save is the person's tap, after they have seen the result.
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

Its native confirmation is one dialog, never two (decision of 2026-11-18). It:

- names the transfer partner's account, and says when that account is closed (decision on sc-5013);
- says both sides are deleted;
- says Undo restores both;
- when any row it deletes is reconciled, adds the reconciled line in the same dialog. Its confirm button then sends `confirmedReconciled: true`.

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
  - save: `draft`, `previewDigest`, `digest`, `undoToken`, `confirmedReconciled`.
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
- **Preset account.** With a native register on screen, Add presets that account. Otherwise it presets the account of the last transaction saved on this device. The view model stores that id in its own UserDefaults key, `AddTransaction.lastAccountId`, after each successful add. It is a per-device convenience, not engine data. It is used only when it is still among the form read's open accounts; otherwise the account is empty and required. There is no default-account setting.
- **Reload after `changed-since` (D8b).** The view model keeps the form read it started from (the base) and an "edited by the person" flag per field and per row, set as the person edits, as `userFields` is. It re-reads the form and compares only engine values: each field of the new read against the same field of the base. Amounts are compared as the integers the reads return.
  - Swift never parses `amountText`. Where it shows the person's amount beside theirs, it shows the last preview's evaluated amount, or the person's text as typed when the field is unchecked.
  - A field the person did not edit takes the new value.
  - A field changed elsewhere that the person also edited keeps the person's value and is listed with both values and "Use other device's".
  - A change only on a split child the person did not edit, or only on a transfer partner (read from `partner`), is also listed in words ("The other side of this transfer changed on another device: date."), with no "Use other device's", because the form shows it nowhere else.
  - Only after the person has seen that list does the draft carry the new digest and the new read become the base. A Reload with nothing to list says nothing changed that affects the form, and adopts the digest.
- **Save timeout.** The sheet shows "Save didn't finish" with Retry. Retry sends the same `newId`, token and draft.
  - For an add, D3 step 2 makes the retry safe.
  - For an edit that did land, the retry gets `changed-since`. The view model re-reads, and if the stored values equal the draft it treats the save as done.
- **Input and result.** It keeps the person's input (the draft) separately from the last preview's `result` and `resultDigest`. It never copies a rule's output into the input.
- **`preview-stale`.** It shows "Rules changed this; check and save again.", previews the same input again, and shows the result with its suggestions (D2a).
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
  - Hidden categories are listed under HIDDEN, disabled, with the reason ("Hidden in the budget…"). The exception: the hidden category a row being edited already has is ticked and selectable, so an edit never forces a change.
  - The category row is disabled, with its reason in words, for an off-budget account and for a transfer between two on-budget accounts.
  - When a `categories` change event arrives, the view model re-reads the form. If that read fails, the picker shows an error with Retry and keeps the last list.
- **Other fields.** Account, date, notes (multiline), cleared, a read-only schedule line, and the Documents row (D7).
- **Rule indicator.** "Set by a rule" on rule-filled fields, and for a hand-set field the rule's suggestion with "Use rule's value" (D2a).
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
  - Between an on-budget and an off-budget account, in either direction, an optional Category row shows only when this transaction is on the on-budget side, with a line for the direction (money leaving the budget counts as spending; money coming in counts as income). On the off-budget side it is hidden, with the reason.
  - This matches how the engine stores a transfer today. `clearCategory` (`server/transactions/transfer.ts`) clears the category only when both accounts are on budget or both are off budget, and the partner row is created without one. The save's existing rule (no category on an off-budget account's rows) keeps the category on the on-budget side. The save needs nothing new for this.
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
- The approved table is Figma node 89:5413, with the Product Owner's corrections in story comment 5150. Hand-off rows say "Opens the web version", never "web view".

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
  - The remainder and each rule suggestion are announced.
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
