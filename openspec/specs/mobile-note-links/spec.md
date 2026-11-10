# mobile-note-links Specification

## Purpose
Defines how web addresses in mobile transaction notes behave, so receipts and documents referenced in notes open directly from the transaction list.

## Requirements

### Requirement: Web addresses render as external links
On mobile, a web address in a transaction note SHALL be shown as a real link whose target is the normalized address.

#### Scenario: HTTPS address in a note
- **WHEN** a note contains `https://example.com/receipt.pdf`
- **THEN** the note preview shows a link to `https://example.com/receipt.pdf`

### Requirement: Opening a link does not open the transaction
Tapping a web link in a mobile note SHALL open the address in a new browser context and SHALL NOT open the surrounding transaction or leave the current list.

#### Scenario: Tap a receipt link in the transaction list
- **WHEN** a user taps a note link in the mobile transaction list
- **THEN** the address opens in a new tab or window
- **AND** the transaction editor does not open and the list stays at its current location

### Requirement: Notes show once in the mobile transaction editor
On the mobile transaction editor, a transaction's notes SHALL appear once. While the notes are not being edited and are not empty, the editor SHALL show the formatted notes (tags and links tappable) and SHALL NOT show the Notes textbox. This applies to the parent transaction and to each split row.

#### Scenario: Open a transaction that has notes
- **WHEN** a user opens a mobile transaction whose notes are `TEST`
- **THEN** the notes appear once, as formatted text
- **AND** the Notes textbox is not shown

#### Scenario: Tag and link in the formatted notes
- **WHEN** the notes contain a tag and a web address
- **THEN** both are shown as tappable in the formatted view
- **AND** the web address is a link with `target="_blank"`, and activating it does not start an edit

#### Scenario: Notes on a split row
- **WHEN** a split row has notes
- **THEN** that row shows its formatted notes once, with the same behavior as the parent

#### Scenario: Empty notes
- **WHEN** a user opens a mobile transaction with no notes
- **THEN** the "Add a note (optional)" textbox is shown

### Requirement: Tap the formatted notes to edit
Tapping the formatted notes outside a link or tag SHALL replace them with the Notes textbox, focused, holding the unchanged note. Tapping a web link, a file-path link or a tag SHALL run that element's own action, if it has one, and SHALL NOT start editing. In the transaction editor a tag has no action, by decision: editing is unsaved state and filtering would leave the editor. Leaving the textbox SHALL show the formatted notes again with the saved value.

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
- **AND** nothing else happens (a decision: the editor tag is inert, because editing is unsaved state and filtering would leave the editor)

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

### Requirement: Formatted notes can be edited by keyboard and screen reader
The formatted notes SHALL be a group labeled as the notes, reachable by keyboard, that starts editing on Enter or Space, and SHALL keep links inside it as real links.

#### Scenario: Keyboard activation
- **WHEN** the formatted notes have focus and the user presses Enter or Space
- **THEN** the Notes textbox is shown with focus

#### Scenario: Screen reader
- **WHEN** a screen reader reaches the formatted notes
- **THEN** it announces a group labeled with the notes' name that can be activated to edit
- **AND** a link inside it is still announced as a link

### Requirement: Tapping a tag filters the list
Tapping a tag in a transaction's notes in a transaction list SHALL filter the list the user is in to transactions whose notes have that tag (`notes hasTags '#tag'`, as on desktop), shown as a removable "#tag x" chip. In a mobile list row the notes line SHALL sit outside the row's button, so a tag or link is never nested inside another interactive control. A long press on a tag SHALL do nothing, by decision: the tag is its own tap target.

#### Scenario: Chip, replace and desktop pills
- **WHEN** a mobile list is filtered by a tag
- **THEN** a removable "#tag x" chip shows above the list, removing it clears the filter and a second tag replaces the first
- **AND** on desktop each clicked tag is added to the register as its own removable filter pill

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

### Requirement: A mobile list row shows pressed feedback and announces its notes
In a mobile transaction list row, pressing the notes line away from a tag or link SHALL show the same pressed tint as pressing the rest of the row, and the row's button SHALL include the row's notes in its accessible name. A tag or link SHALL NOT become a descendant of a button to achieve either.

#### Scenario: Press the notes line
- **WHEN** a user presses and holds the notes line of a mobile list row away from any tag or link
- **THEN** the row shows the same pressed tint as when its button is pressed
- **AND** the tint clears when the press ends or is cancelled

#### Scenario: Press a tag
- **WHEN** a user presses a tag in a mobile list row
- **THEN** the row does not show the row pressed tint, because the tag is its own tap target

#### Scenario: A press on a link or tag that never ends
- **WHEN** a press starts on a link or tag in a mobile list row and never ends in the row, for example a receipt link that opens a new window
- **THEN** the row does not set or hold the pressed tint
- **AND** the next tap on the row opens the transaction as usual

#### Scenario: Screen reader reaches the row
- **WHEN** a screen reader reaches the row's button in a mobile list row that has notes
- **THEN** its accessible name includes the payee, category and amount and the notes text
- **AND** the tag and link in the notes are still separate controls, not inside the button

#### Scenario: Row without notes
- **WHEN** a mobile list row has no notes
- **THEN** its accessible name is unchanged

#### Scenario: Desktop parity
- **WHEN** a narrow desktop window shows the mobile list
- **THEN** the same feedback and accessible name apply
- **AND** the wide desktop register is unchanged, because its tag is already a separate control
