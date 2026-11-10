# Proposal

## Why

Shortcut sc-3199 (epic 470, Baseline fork behavior). Two non-blocking findings from the UX Designer's review of #276 (sc-3070), which moved the notes line out of the row's button: (1) the notes line shows no pressed tint, unlike the rest of the row; (2) the row button's screen-reader name no longer includes the notes. The Product Owner also asked that the editor-tag decision, which after the sc-3070 archive lives only in a scenario, be stated in a requirement's text again.

## What Changes

- Pressing the notes line (away from a tag or link) shows the row's pressed tint, and clears it when the press ends or is cancelled.
- The row's button includes the notes in its accessible name, with no tag or link becoming a descendant of the button (the sc-3070 axe criterion holds).
- The requirement "Tap the formatted notes to edit" states in its text that a tag in the transaction editor has no action, by decision.

Out of scope: any new visual design, tag behavior in the editor, removing the upstream option wrapper (decision 8 of sc-3070's design).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mobile-note-links`: modifies "Tap the formatted notes to edit"; adds "A mobile list row shows pressed feedback and announces its notes".

## Mobile scope

Mobile screens in `packages/desktop-client/src/components/mobile/`: `transactions/TransactionListItem.tsx` (All accounts, single account, On/OffBudget, reconcile layout). Desktop: tests only; a narrow desktop window gets the mobile behavior.
