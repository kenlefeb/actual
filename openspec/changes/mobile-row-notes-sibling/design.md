# Design

## Decisions

1. **Notes line becomes a sibling of the row button (option C).** In `components/mobile/transactions/TransactionListItem.tsx` the react-aria `Button` (a real `<button>`, wrapped in `PressResponder` with `mergeProps(pressProps, longPressProps)`) currently contains the notes line with `NotesTagFormatter`. The row becomes a container holding the `Button` (payee, category, amount) and, after it, a notes element outside the button. The notes element receives the same merged press and long-press props, so a press away from a tag or link opens the transaction and a long press selects it. Tags and links are then siblings of a `<button>`, not descendants.
2. **Same look.** Layout, spacing, ellipsis and the pressed highlight stay as today. The UX Designer confirms visual parity (existing VRT snapshots for the mobile list must not change); this is not a redesign. The reconcile layout has less room, so the tasks check it explicitly.
3. **Keyboard and screen reader.** The notes element is a pointer target for the row's press; the row's single keyboard stop stays the `<button>`. Tags keep `role="button"`, `tabIndex={0}` and the name "Filter by #tag", and links stay real links, so each remains reachable.
4. **Long press on a tag is a no-op (decision).** `MobileTaggedNotes` keeps stopping mouse, touch and pointer propagation, so a gesture that starts on a tag never reaches the row's press or long press. Rejected: letting the long press through and suppressing the click (fragile with react-aria press handling, and a long press meant to filter would select instead). A long press elsewhere on the row, including the notes line, still selects.
5. **Tag in the editor stays inert (decision).** Replaces the "known gap" wording from sc-2989/sc-3069. `components/mobile/transactions/NotesField.tsx` passes no tag handler; leaving the editor could lose unsaved edits. A tap on a tag there does not start editing.
6. **Rejected options.** Leave nested (accepts a serious a11y defect on the most-used mobile screen). Make the tag pointer-only (drops `role` and `tabIndex`, passes axe, but keyboard and VoiceOver users lose tag filtering). Re-role the row as a grid cell or list option containing controls (touches selection semantics, too large for one control).
7. **Desktop parity.** The desktop register tag is `DesktopTaggedNotes` (`Button variant="bare"`) in a table cell, not inside another button, so it has no nested-interactive pattern; long press does not exist on desktop. Tests assert the tag is a separate control there. A narrow desktop window renders the mobile list and is covered by the mobile scenarios.

## Verification

- A Tester runs axe-core with Playwright on the live mobile list (mobile viewport, All accounts and a single account, with a note that has a tag and a link) before the fix and records the `nested-interactive` failure, then again after. Colour-contrast is included in the live run (jsdom cannot compute it); any other finding is filed per the defect rule, not folded in.
- Component tests on `TransactionListItem` are written before the fix and fail first: no `button` contains a tag; a press on the notes line away from a tag opens the transaction; a long press on the notes line selects; a long press on a tag does nothing.

## Risks

- A tap or long press must still cover the notes line after the move; the tests above pin it.
- Reconcile-layout rows have less room; the sibling must not change row height or truncation.
- axe-core is a transitive dependency only. The e2e test adds it as an explicit dev dependency of `@actual-app/web` (check `yarn.lock` churn against the audit rules).
