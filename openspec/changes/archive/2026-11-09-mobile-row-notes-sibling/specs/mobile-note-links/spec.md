## MODIFIED Requirements

### Requirement: Tap the formatted notes to edit
Tapping the formatted notes outside a link or tag SHALL replace them with the Notes textbox, focused, holding the unchanged note. Tapping a web link, a file-path link or a tag SHALL run that element's own action, if it has one, and SHALL NOT start editing. In a transaction list a tag's own action is to filter that list (see "Tapping a tag filters the list"); in the transaction editor a tag has no action, by decision (editing is unsaved state, and filtering would leave the editor). Leaving the textbox SHALL show the formatted notes again with the saved value.

#### Scenario: Tap to edit
- **WHEN** a user taps the formatted notes away from any link or tag
- **THEN** the Notes textbox is shown with focus and the note text
- **AND** the formatted notes are hidden

#### Scenario: Tap a tag
- **WHEN** the notes contain a tag and a user taps it in a mobile transaction list
- **THEN** the list is filtered by that tag
- **AND** the transaction editor does not open and the Notes textbox is not shown

#### Scenario: Tap a tag in the transaction editor
- **WHEN** the notes contain a tag and a user taps it in the formatted view in the mobile transaction editor
- **THEN** the Notes textbox is not shown and the notes stay formatted
- **AND** nothing else happens (a decision: the editor tag is inert, so unsaved edits are never lost)

#### Scenario: Tap a file-path link in the app
- **WHEN** the notes contain a file path and a user taps it in the desktop app (Electron) on a narrow screen
- **THEN** the path opens in the file manager
- **AND** the Notes textbox is not shown

#### Scenario: Tap a file-path link in a browser
- **WHEN** the notes contain a file path and a user taps it in a browser
- **THEN** the path is copied to the clipboard and "File path copied to clipboard" is shown
- **AND** the Notes textbox is not shown

#### Scenario: Blur returns to the formatted view
- **WHEN** a user edits the note and leaves the textbox
- **THEN** the formatted notes are shown again, reflecting the edit
- **AND** the saved value equals what the user typed, including every line break

#### Scenario: Type into an empty note
- **WHEN** a user focuses the empty Notes textbox and types
- **THEN** the textbox stays shown and focused while they type, and the formatted notes appear only after they leave it

#### Scenario: Another field is being edited
- **WHEN** a different field of the transaction is being edited, so the Notes textbox would be disabled
- **THEN** tapping the formatted notes does nothing
- **AND** the formatted notes are exposed as disabled

#### Scenario: Clear the note
- **WHEN** a user deletes all the text and leaves the textbox
- **THEN** the "Add a note (optional)" textbox is shown

### Requirement: Tapping a tag filters the list
Tapping a tag in a transaction's notes in a transaction list SHALL filter the list the user is in, whether all accounts or a single account, to transactions whose notes have that tag (`notes hasTags '#tag'`, as on desktop). The active tag SHALL show as a removable "#tag x" chip above the list. On mobile, removing the chip SHALL clear the tag filter and a second tag SHALL replace the first; on desktop each clicked tag SHALL be added to the register as its own removable filter pill. In a mobile list row the notes line SHALL sit outside the row's button, so a tag or link is never nested inside another interactive control. A long press on a tag SHALL do nothing, by decision: the tag is its own tap target.

#### Scenario: Filter the all-accounts list
- **WHEN** a user taps `#vacation` in a note in the mobile All accounts list
- **THEN** the list shows only transactions tagged `#vacation`, across all accounts
- **AND** a "#vacation x" chip is shown above the list and the editor does not open

#### Scenario: Filter a single account
- **WHEN** a user taps `#vacation` in a note in one account's mobile list
- **THEN** the list shows only that account's transactions tagged `#vacation`

#### Scenario: Clear with the chip
- **WHEN** a user taps the x on the "#vacation x" chip
- **THEN** the chip disappears and the list shows all its transactions again

#### Scenario: A second tag replaces the first
- **WHEN** a list is filtered by `#vacation` and the user taps `#work`
- **THEN** the list is filtered by `#work` only and the chip reads "#work x"

#### Scenario: Nothing matches
- **WHEN** the tag filter leaves no transactions
- **THEN** the list is empty and the chip is still available to clear the filter

#### Scenario: Tag filter and search together (mobile)
- **WHEN** a list is filtered by `#vacation` and the user types search text
- **THEN** the list shows only transactions that have the tag and match the text
- **AND** clearing the text keeps the tag filter, and removing the chip keeps the text

#### Scenario: A single account with a condition active
- **WHEN** a single-account mobile list has any filter condition active (a tag, or a report drill-down, which single-account lists now also accept)
- **THEN** it behaves like the All accounts list: split child transactions are listed, and scheduled previews and running balances are not shown

#### Scenario: No nested interactive control in a list row
- **WHEN** a mobile list row has notes containing a tag and a link
- **THEN** the tag and the link are not descendants of the row's button
- **AND** an axe check of the mobile list (All accounts and a single account) reports no `nested-interactive` node that contains a tag or a link
- **AND** the row's own option wrapper around its button is upstream's structure and is not part of this requirement

#### Scenario: Press the notes line
- **WHEN** a user taps the notes line of a mobile list row away from any tag or link
- **THEN** the transaction opens

#### Scenario: Long press the row
- **WHEN** a user long-presses a mobile list row, including its notes line, away from any tag
- **THEN** multi-select starts with that transaction selected

#### Scenario: Long press a tag
- **WHEN** a user long-presses a tag in a mobile list row
- **THEN** nothing is selected, no filter is applied and the transaction does not open

#### Scenario: Tag stays keyboard and screen-reader reachable
- **WHEN** a keyboard or screen-reader user reaches a tag in a mobile list row
- **THEN** it is exposed as a button named "Filter by #tag" and activating it filters the list

#### Scenario: Desktop parity
- **WHEN** a user clicks a tag in a note in the desktop register (all accounts or one account)
- **THEN** the register adds the `notes hasTags '#tag'` filter as a removable filter pill, and clicking the same tag again does not duplicate it
- **AND** clicking a second tag adds a second pill, so both conditions apply (desktop stacks tags; only mobile replaces)
- **AND** the tag is a separate control, not nested inside another button
- **AND** a narrow desktop window uses the mobile behavior above
