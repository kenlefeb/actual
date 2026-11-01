# Spec Delta

## ADDED Requirements

### Requirement: Notifications are reachable on a phone
On a narrow screen with in-app notifications on, the Settings page SHALL list a Notifications row that opens the notifications page, with a row height of at least 40px, and the row SHALL show the number of unseen entries when there are any. The row SHALL be absent when in-app notifications are off, and a wide screen SHALL keep the titlebar bell as its entry point.

#### Scenario: Open the notes after dismissing the message
- **GIVEN** a phone with in-app notifications on, and the "What's new" message dismissed
- **WHEN** the user opens Settings and chooses Notifications
- **THEN** the notifications page opens

#### Scenario: The unseen count
- **GIVEN** a phone with in-app notifications on and two unseen entries
- **WHEN** the user opens Settings
- **THEN** the Notifications row shows 2, and after the user has opened the notifications page it shows no count

#### Scenario: Off means no row
- **GIVEN** in-app notifications are turned off
- **WHEN** the user opens Settings on a phone
- **THEN** there is no Notifications row

#### Scenario: Desktop keeps the bell
- **GIVEN** a wide screen with in-app notifications on
- **WHEN** the user looks for the way to the notifications page
- **THEN** the titlebar bell opens it, and the Settings list has no Notifications row
