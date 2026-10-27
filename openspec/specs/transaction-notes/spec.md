# transaction-notes Specification

## Purpose
Defines how transaction notes accept, keep and display multiple lines on desktop and mobile, so notes holding document references survive editing on any device.

## Requirements

### Requirement: Notes preserve line breaks
Transaction notes SHALL keep their line breaks when opened, edited, blurred and saved, on desktop and mobile, for parent and split transactions.

#### Scenario: Desktop open and blur without changes
- **WHEN** a user opens a multiline note in the desktop transaction table and leaves the field without editing
- **THEN** the stored transaction is unchanged

#### Scenario: Mobile note loses focus
- **WHEN** a user focuses and then leaves a multiline note on mobile
- **THEN** the saved value equals the original, including every line break

### Requirement: Desktop multiline note entry
The desktop note editor SHALL insert a new line on Shift+Enter without saving, while Tab and Shift+Tab SHALL save the note and move between table fields.

#### Scenario: Add a line and move on
- **WHEN** a user presses Shift+Enter, types more text and presses Tab
- **THEN** the note is saved with the new line and focus moves to the next field

#### Scenario: Shift+Tab after a new line
- **WHEN** a user inserts a new line with Shift+Enter and then presses Shift+Tab
- **THEN** focus moves to the previous field

### Requirement: Full note on hover
The desktop transaction table SHALL show the complete note, with all its lines, on hover even when the note fits horizontally, while rows keep their compact height.

#### Scenario: Short multiline note
- **WHEN** a user hovers a multiline note that fits within the column width
- **THEN** a tooltip shows every line of the note

### Requirement: Tag insertion keeps line breaks
Inserting a tag into a multiline note through tag completion SHALL leave the note's existing line breaks intact.

#### Scenario: Insert a tag into a multiline note
- **WHEN** a user inserts a tag into a note that contains line breaks
- **THEN** the note contains the tag and all of its original line breaks

### Requirement: Notes round-trip across devices
A multiline note written on mobile SHALL appear unchanged in the desktop editor, and a line added on desktop SHALL be kept with the original lines.

#### Scenario: Mobile note edited on desktop
- **WHEN** a user saves a multiline note on mobile and opens it in the desktop editor
- **THEN** the desktop editor shows the same note
- **AND** adding a line with Shift+Enter and pressing Tab saves the original lines plus the new one
