# Tasks

**Tests first:** write the tests, see them fail, then write the code.

**Order:** one PR per group, in order. Group 1 blocks group 2, which blocks group 3. All three ship story sc-3602.

## 1. Engine: form reads, preview, save, limits and gates (sc-3602)

- [x] 1.0 Shared row state (design D1): add `parent_id`, `is_parent`, `is_child` and `sort_order` to `readTouchedState`, additively. The accounts-write tests must stay green. The digest is the SHA-256 of that state over the touched set, with no second reader.
- [x] 1.1 `native/transaction-form` in `server/native/transaction-form.ts` (design D1).
  - Each open account carries its `transferPayee` id, and each transfer row carries its `partner` fields (design D1, added 2026-11-18).
  - Categories include hidden ones, marked `hidden` (added 2026-11-18).
  - Write failing contract tests first on a seed that has:
    - on-budget, off-budget and closed accounts;
    - hidden categories;
    - a split with a transfer child;
    - a reconciled row and a scheduled row.
  - The tests check:
    - names resolved;
    - the digest covers the parent, children and partners;
    - a deleted id or a closed account's transaction fails with `[native:not-found]`;
    - a child added, or a transfer relinked, changes the digest.
  - Add the fixture `transaction-form.json`.
- [x] 1.2 `native/payees` (design D1).
  - Write failing tests first:
    - favourites first, then by name;
    - only live payees, and only `{id, name, favorite}`;
    - transfer payees excluded;
    - `payee-search-max-length` (default 100, ceiling 200) refuses longer text;
    - `%`, `_` and `\` match literally;
    - `payee-picker-max-results` defaults to 50, has a ceiling of 500, and malformed values fall back.
  - Add both limits to the `LIMITS` registry.
  - Add the fixture `payees.json`.
- [x] 1.3 `native/transaction-preview` (design D2).
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
    - the draft-key whitelist refuses unlisted keys and wrong types with `[native:invalid-draft]`;
    - the draft is the person's input; `userFields` (every field the person edited, plus a preset account) is never changed by a rule, including on a payee change; each such field a rule would set differently is returned in `suggestions` with the rule's value;
    - `result` and `resultDigest`:
      - canonical JSON as in design D2: an array of rows, parent first then `splits` order, so count and order count; fields account, amount, category, cleared, date, notes, the row's own tagged payee, schedule; keys sorted;
      - reordered children, an added child or a changed child payee change the digest;
      - the same input gives the same digest, and key order does not matter;
      - one canonical hash helper is shared with the edit digest, over separate inputs;
    - each result row carries the engine's `amountText`;
    - suggestions are found with one unprotected run and confirmed per candidate; taking one (field removed from `userFields`) gives exactly the suggested value; no extra run when nothing is hand-set;
    - `changedField` is gone from the preview's shape, and the page's argument list is `draft` only;
    - a trailing decimal separator (`12.`, `12,` in comma-decimal formats) reads as no fraction, in the preview and the save; a trailing grouping separator is refused;
    - `ruleFields` lists fields a rule set that the person did not touch;
    - amount text over 100 characters, non-finite, fractional minor units and values beyond `MAX_SAFE_INTEGER` are `amount-invalid`;
    - dates outside 1900-01-01 to 2999-12-31 are `date-invalid`, and future dates are allowed;
    - notes over `transaction-notes-max-length` on any row are `notes-too-long`;
    - a transfer payee with a closed or deleted account is `account-closed`;
    - no payee is ever created, and nothing is written, including for a rule that sets a payee by name: the payee count is unchanged after many previews and after the `ruleFields` re-run (`runRules` with payee names unresolved);
    - the amount grammar (design D2), with every accept and refuse scenario of the spec run in each of the five number formats;
    - `amount-invalid` errors carry `detail.decimalSeparator` (`.` or `,`, from the format, never typed text); the other codes have no detail;
    - NBSP, U+202F and U+2019 grouping; Indian grouping; `× ÷ −` mapped; one currency symbol ignored; surrounding whitespace dropped;
    - `1e20`, `0x10`, `1_000`, `^`, `1..5`, `12abc`, a trailing operator, a misplaced group and a leading `+` are `amount-invalid`;
    - a leading `-` or `−` and a negative result are `amount-negative`, with the direction unchanged;
    - the upstream edit is only `runRules`'s optional parameter and the branch around `insertPayee` in `transaction-rules.ts`, with `rules-run` and the default unchanged (a test that the default still creates the payee);
    - the split count is checked before any child is evaluated or looked up;
  - Add the fixtures `transaction-preview.json` and `transaction-field-errors.json`, with a test that the field codes and the refusal codes share no code.
- [x] 1.4 `native/transaction-save` (design D3), in the order of D3.
  - Write failing tests first:
    - no undo token, or a bad shape, is `[native:invalid-draft]`;
    - a repeated `newId`:
      - a live matching row returns its id and writes nothing, including after an engine restart (reload the budget in the test);
      - a different draft, a split child's id, or another account's row is `[native:invalid-draft]`;
      - a `newId` that is not a lowercase UUID (`ABC`, `../x`, upper case, 500 characters) is `[native:invalid-draft]`;
      - an undone or deleted row is `[native:changed-since]` with no id;
    - an edit without a digest, or with a changed parent, child, partner, link or schedule, is `[native:changed-since]`;
    - for an add, the result is computed once on the same input as the preview; it is stored only when its digest equals `previewDigest`, or, with none, when no rule changed the input; otherwise `[native:preview-stale]`; a rule that sets a closed account refuses;
    - a made-up or stale `previewDigest` refuses with `preview-stale`, and nothing is stored;
    - split ids: an add naming any existing row's id as a child (a reconciled row in another account in the test) is `[native:invalid-draft]`, and that row is unchanged; an edit naming a row that is not its own live child is refused the same way; its own children update in place;
    - an edit of a row whose account was closed after the form read is `[native:not-found]`;
    - currency symbols: with a currency set, only its symbol (and its final sign alone) is ignored, and `€12` in a USD budget is `amount-invalid`; with none set, any one currency symbol is ignored;
    - an edit checks both digests, each with its own refusal;
    - loop tests: notes typed before a payee whose rule sets notes save on the first attempt; an append-notes rule saves "lunch #bulk" on the first attempt with a digest, and on the second without one, never appending twice;
    - the touched set (children removed, partners old and new) is computed on the post-rules draft before any write;
    - `[native:invalid-draft:<codes>]` for each validation rule, with only fixture codes in the message;
    - `[native:needs-confirmed-reconciled]` for a reconciled row, child, partner or split parent (`"true"` and `1` refused);
    - payee names:
      - trimmed and non-empty, within `payee-name-max-length`;
      - a case-insensitive match reuses the live payee;
      - a transfer payee's name refuses;
    - `transaction-notes-max-length` applies to every row;
    - `transaction-split-max-children` defaults to 50, has a ceiling of 200, and malformed values fall back;
    - a new payee is created in the same undo step;
    - rules run again on add;
    - `learn-categories` is honoured;
    - an equal-input comparison with `transactions-batch-update` as the web calls it;
    - a repeated token returns the same id;
    - nothing changes on any refusal.
  - Add `changed-since`, `preview-stale` and `not-found` to the shared `native-refusal-codes.json`.
  - `category-hidden` (added 2026-11-18): refused on a new row, or on a row whose stored category is another one. Allowed on an edited row that already has it. Tests cover the preview and the save.
  - Tests for D3 step 4:
    - evaluating `amountText` is not a difference;
    - a rule change to any rule-settable field on any row refuses with `preview-stale` before any write, whether or not a preview was answered.
  - Tests that a transfer payee of the transaction's own account is refused with `transfer-same-account`, and one of a closed account with `account-closed`.
- [x] 1.4a Add the reconciled-split-parent rule to `native/transactions-delete`. Write failing tests first: a partner inside a reconciled split needs `confirmedReconciled`.
- [x] 1.5 Undo conflict check for saves (design D3). The save records `readTouchedState`. `native/undo` refuses with `[native:undo-changed-since]` after a later change to a touched row.
  - Write failing tests first, with an edit applied after the save, as a sync would apply it.
- [x] 1.6 `transaction-form.perf.test.ts` (design D5). Use the stated seed and the six measurements, each with a median under 50 ms. Print the median and p95. If the rules cases miss 50 ms, stop and report the numbers to the Director before changing the design.
- [ ] 1.7 Allowlists (design D4):
  - add the four names to `native-bridge-allowlist.json` and the Swift client list, with a test that the lists are equal;
  - add the page argument lists in `nativeBridge.ts`, with a test that extra fields are dropped;
  - add the origin-guard names;
  - the save's argument list adds `previewDigest` (PR #453);
  - the page-side checks for `webTransactionAction`: the closed action set, an id matching `[A-Za-z0-9_-]+` that is a live transaction, and `encodeURIComponent` in the path;
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
  - Delete goes through `native/transactions-delete`, and its dialog names the partner account and says when it is closed;
  - `newId` is kept for the sheet's lifetime and reused by Retry;
  - an edit retry that gets `changed-since` re-reads and finishes when the stored values equal the draft;
  - `preview-stale` shows "Rules changed this; check and save again.", previews again and shows the rule's result;
  - the input is kept apart from the last `result`, and a rule's output is never copied into it; every field the person edits joins `userFields`; a field leaves it only through "Use rule's value", which previews again;
  - suggestions show under their field with "Use rule's value", announced to VoiceOver;
  - after two `preview-stale` refusals in a row on the same input:
    - it stops refreshing on its own and names the fields whose values differ between the last two results (engine values only);
    - "Keep this value" copies the engine's value (`amountText` for an amount) into the input and adds the field to `userFields`;
    - a time-dependent fake rule ends in a stored save;
  - the save sends the last `resultDigest`, or null while unchecked;
  - a form-read `not-found` shows the unavailable state;
  - the preset account comes from the register on screen, else `AddTransaction.lastAccountId` if still open, else empty and required; the key is written after each successful add;
  - Delete of a reconciled row is one dialog with the reconciled line, which sends `confirmedReconciled: true`;
  - a preview timeout retries once after `previewRetryDelay` and once on foreground, then shows the unchecked state, with Save still enabled;
  - Reload after `changed-since`:
    - compares only engine values (new read against base) with per-field edited flags, and never parses `amountText`;
    - lists both-changed fields with "Use other device's";
    - lists child-only and partner-only changes;
    - adopts the new digest only after showing that list;
  - choosing a transfer payee sets Transfer, and leaving Transfer clears To account.
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
- category row disabled, with its reason (off-budget, on-budget transfer);
- the category picker: groups, search, Uncategorized, the tick, and the error with Retry;
- the Transfer state: the Expense / Income / Transfer control, the To account row, the direction wording, and the category hidden with its reason;
- Reload keeping the person's edits, with the both-changed list and "Use other device's";
- "Couldn't check this yet." with Check Again;
- the copy table (frame, element, text), approved by the Product Owner, including two new rows for approval:
  - Amount / `amount-invalid`: a sentence naming the budget's decimal separator with an example ("Use . for decimals, like 12.50"; "Use , for decimals, like 12,50");
  - Amount / `amount-negative`: a sentence that points to the Expense and Income control;
- "Set by a rule", and the rule suggestion line with its "Use rule's value" button under a hand-set field;
- the "Rules keep changing {fields}" message with "Keep this value", and copy-table rows for both;
- copy-table rows for approval: the suggestion line ("The rule for {payee} would set {Field} to {value}.") and the "Use rule's value" button, with its VoiceOver announcement;
- the "Not checked" state after a preview timeout;
- Cancel's discard confirmation;
- Delete's confirmation, naming the partner and a closed account;
- reconciled confirm;
- "changed on another device" and Reload's "what changed" view;
- "Can't undo — changed since" after the Undo toast;
- "Save didn't finish";
- form-read failure ("no longer available");
- the loading state while the form reads;
- the Documents row and hand-off rows, including "documents can be added once it is saved";
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
- [ ] 3.0 Transfer state (design D8a): the three-way control, To account and direction, the category rules, and switching modes. Add UI tests.
- [ ] 3.0a Category picker (design D8d): search, Uncategorized, tick by id, and the error with Retry. Add UI tests.
- [ ] 3.0b Copy (design D8e): every string is localized from the approved copy table, with a test for hard-coded strings.
- [ ] 3.1a The rule indicator, hand-set fields that stay, and suggestions with "Use rule's value" (design D2a). Add UI tests and VoiceOver announcements.
- [ ] 3.2 Splits: add and remove a child, the remainder in words, the `split-limit` state.
- [ ] 3.3 Transfers and category rules: the off-budget and on-budget transfer wording.
- [ ] 3.4 Edit mode:
  - Delete, confirmed by a dialog that names the partner account, says when it is closed, says both sides go and that Undo restores both;
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
- **sc-4643:** the Settings screen edits `payee-picker-max-results`, `payee-search-max-length`, `payee-name-max-length`, `transaction-notes-max-length` and `transaction-split-max-children`.
- **sc-4877:** extend the Swift-minted nonce to `confirmedReconciled` on the save.

## Workflow follow-up

- Archive when group 3 merges. Then:
  - move the story's change link to the archive path;
  - add the `spec:native-add-transaction` label;
  - add the spec to epic 470's description.
