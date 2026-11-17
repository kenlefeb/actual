# Tasks

Test-first: write the tests, see them fail, then write the code. One group per PR; group 1 ships first.

## 1. loot-core: the shared lock selection and the step 3 and 4 handlers (sc-4825)

- [x] 1.1 `lockPlan` in `server/accounts/reconcile-plan.ts` (design D1). Failing contract test first on one fixture (splits, a reconciled parent with an unreconciled child, transfers, an uncleared row): its set equals the MCP's `reconciliation()` and the web `lockTransactions` selection
- [x] 1.2 `native/reconcile-matches` and the `search` argument on `native/reconcile-rows` (design D2). Failing tests first: single, pair, untick, order, the candidates and results limits, swapped digits, payee and notes, `%` and `_` in the text match literally, an over-long text fails, candidates capped before the pair search, a perf test like `reconcile.perf.test.ts`
- [x] 1.3 The limit preferences (design D7) with `^\d+$` parsing, defaults and ceilings. Failing tests first: defaults, a setting changes each, `1e1`, zero and above-ceiling fall back
- [x] 1.4 `native/reconcile-lock-preview` (design D3). Failing tests first: rows, partners not locked, skipped children, counts, the list cut with exact counts, a digest that changes when any row, partner or balance changes
- [x] 1.5 `native/reconcile-adjust` (design D4). Failing tests first: needs a usable record, amount must equal the difference, created as the app does (cleared, today, notes, rules run), an explicit category wins, off-budget account refuses a category, a missing or deleted category id and a label that is not 1 to 100 characters fail, one undo step, no `api/` handler exposes it
- [x] 1.6 `native/reconcile-lock` (design D5). Failing tests first: refuses without a usable record or at a non-zero difference, refuses a stale digest, locks in one batch and only the plan's rows, consumes whenever rows locked including unverified, stamps only when verified, zero-row verified stamps and consumes, adjust, lock, then `native/undo` with the adjustment's token (and with any token) is refused and the rows stay locked, the lock's step carries a marker no token matches, no `api/` handler exposes the lock
- [x] 1.7 Allowlist the four handlers (Swift list and `native-bridge-allowlist.json`), tests first: the lists are equal, an off-list name is refused natively
- [x] 1.8 The mobile add form's existing `amount` parameter (design D2): finite and bounded, else 0; `add_amount_param` from loot-core. Failing tests first: a difference of +4180 cents gives a form amount of +4180, -4180 gives -4180, `1e999` and `abc` give 0, nothing saves without Save; typecheck, lint, `openspec validate --all --strict`, tests

## 2. iPhone: steps 3 and 4, the adjustment sheet and done (sc-4825)

- [x] 2.1 Swift view models (`ReconcileResolveViewModel`, `ReconcileLockViewModel`) against a fake transport and fixtures: matches and search states keep the last values, the live difference, the adjustment's stale-amount failure, the lock's verified and unverified results, coalesced re-reads. Failing tests first
- [x] 2.2 Step 3 screen: likely match, search, add the missing transaction (closes to the checklist, opens the add form), back to tick off, and the adjustment group last; the medium-detent adjustment sheet with the amount in its button and the budget line, category optional. Replace B1's "finish in the register" exit with Continue to step 4
- [x] 2.3 Step 4 screen: summary, What locks with exact counts, linked transfers not locked, balance on record, the lock note, "Lock N transactions" and "Not now — keep my ticks"; remove-adjustment through `native/undo`
- [x] 2.4 Reopen In progress at step 2 with the recorded balance; step 2's "Continue to lock" at zero (haptic, "Difference zero" announcement, no auto-advance); step 3's auto-advance at zero; "Untick it" label. Done screen, haptic and announcement, next due account, the checklist's Done; handle an unverified result
- [ ] 2.6 File the deferred Backlog story: a Swift-minted one-shot confirmation nonce for native adjust and lock (design D9), for production hardening
- [ ] 2.5 Dynamic Type to AX5, VoiceOver order and announcements (step, difference as a live region, "Joint Checking is reconciled"), Dark Mode, localization; verify in the Simulator against the Figma frames once the Designer has corrected frames 54:406 and the adjustment date; UX Designer review

## Workflow follow-up

- Archive when sc-4825 merges, after `native-reconcile-flow` archives (design D8). Then move the story's change link to the archive path.
- Backlog stories: the MCP lock onto `lockPlan` (needs a fork handler); the Mac flow is sc-4872.
