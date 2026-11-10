## MODIFIED Requirements

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

## ADDED Requirements

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
