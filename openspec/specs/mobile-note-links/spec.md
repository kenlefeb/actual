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
Tapping the formatted notes outside a link or tag SHALL replace them with the Notes textbox, focused, holding the unchanged note. Tapping a web link, a file-path link or a tag SHALL run that element's own action, if it has one, and SHALL NOT start editing. In a transaction list a tag's own action is to filter that list (see "Tapping a tag filters the list"); in the transaction editor a tag has no action. Leaving the textbox SHALL show the formatted notes again with the saved value.

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
- **AND** nothing else happens (a known gap: the editor does not filter, so unsaved edits are never lost)

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
Tapping a tag in a transaction's notes in a transaction list SHALL filter the list the user is in, whether all accounts or a single account, to transactions whose notes have that tag (`notes hasTags '#tag'`, as on desktop). The active tag SHALL show as a removable "#tag x" chip above the list. On mobile, removing the chip SHALL clear the tag filter and a second tag SHALL replace the first; on desktop each clicked tag SHALL be added to the register as its own removable filter pill.

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

#### Scenario: Desktop parity
- **WHEN** a user clicks a tag in a note in the desktop register (all accounts or one account)
- **THEN** the register adds the `notes hasTags '#tag'` filter as a removable filter pill, and clicking the same tag again does not duplicate it
- **AND** clicking a second tag adds a second pill, so both conditions apply (desktop stacks tags; only mobile replaces)
- **AND** a narrow desktop window uses the mobile behavior above
