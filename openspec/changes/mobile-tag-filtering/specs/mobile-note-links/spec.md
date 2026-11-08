## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Tapping a tag filters the list
Tapping a tag in a transaction's notes in a transaction list SHALL filter the list the user is in, whether all accounts or a single account, to transactions whose notes have that tag (`notes hasTags '#tag'`, as on desktop). The active tag SHALL show as a removable "#tag x" chip above the list, and a second tag SHALL replace it. Desktop SHALL behave the same, with a removable filter.

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
- **THEN** the list shows the filtered empty state, with the chip still available to clear it

#### Scenario: Desktop parity
- **WHEN** a user clicks a tag in a note in the desktop register (all accounts or one account)
- **THEN** the register adds the `notes hasTags '#tag'` filter as a removable filter pill, and clicking the same tag again does not duplicate it
