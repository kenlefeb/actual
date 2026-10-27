# Spec Delta

## Purpose

Defines how edits to one part of a split transaction in the mobile editor stay isolated from the parent and the other splits.

## ADDED Requirements

### Requirement: Split edits are isolated
Saving an edit to one split in the mobile transaction editor SHALL leave the parent transaction's fields and every sibling split unchanged.

#### Scenario: Edit one split's note
- **WHEN** a user changes the note of one split and saves the transaction on mobile
- **THEN** that split has the new note
- **AND** the parent note and the other splits' notes are unchanged

#### Scenario: Edit the parent note
- **WHEN** a user changes the parent note of a split transaction and saves on mobile
- **THEN** every split's note is unchanged

### Requirement: Split notes are multiline on mobile
Each split's note in the mobile transaction editor SHALL be a multiline field that keeps line breaks.

#### Scenario: Multiline split note
- **WHEN** a user enters a split note containing a line break and saves on mobile
- **THEN** reopening the transaction shows the split note with its line break
