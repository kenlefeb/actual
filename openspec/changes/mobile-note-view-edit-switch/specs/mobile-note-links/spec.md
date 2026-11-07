## ADDED Requirements

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
Tapping the formatted notes outside a link or tag SHALL replace them with the Notes textbox, focused, holding the unchanged note. Leaving the textbox SHALL show the formatted notes again with the saved value.

#### Scenario: Tap to edit
- **WHEN** a user taps the formatted notes away from any link
- **THEN** the Notes textbox is shown with focus and the note text
- **AND** the formatted notes are hidden

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
