# Spec Delta

## MODIFIED Requirements

### Requirement: Desktop multiline note entry
The desktop note editor SHALL insert a new line on Shift+Enter without saving, while Tab and Shift+Tab SHALL save the note and move between table fields, and plain Enter SHALL save the note and move to the same field in the next row.

#### Scenario: Add a line and move on
- **WHEN** a user presses Shift+Enter, types more text and presses Tab
- **THEN** the note is saved with the new line and focus moves to the next field

#### Scenario: Shift+Tab after a new line
- **WHEN** a user inserts a new line with Shift+Enter and then presses Shift+Tab
- **THEN** focus moves to the previous field

#### Scenario: Enter saves and moves down
- **WHEN** a user edits a multiline note and presses Enter
- **THEN** the note is saved with all of its line breaks
- **AND** focus moves to the note field of the next row
