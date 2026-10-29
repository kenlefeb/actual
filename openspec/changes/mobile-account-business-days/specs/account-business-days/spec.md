# Spec Delta

## MODIFIED Requirements

### Requirement: Account business calendar
An account SHALL optionally have a business calendar. With the `businessCalendars` experimental feature on, the account menu SHALL offer "Business days", where the user chooses one of their business calendars or none. On desktop layouts this is the account page's menu; on narrow (mobile) layouts it is the account menu opened from the account page. An account without a calendar uses Saturday and Sunday as its only non-business days.

#### Scenario: Choose a calendar for an account
- **WHEN** the user opens "Business days" for "Checking" and chooses "U.S. Federal Reserve"
- **THEN** "Checking" keeps that calendar, and the dialog shows it when reopened

#### Scenario: Choose a calendar on a phone
- **GIVEN** the `businessCalendars` experimental feature is on and the layout is narrow
- **WHEN** the user opens the "Checking" account page, taps the account name, taps "Business days", chooses "U.S. Federal Reserve" and 1 business day early, and saves
- **THEN** "Checking" keeps that calendar and 1 business day early, exactly as when saved on desktop, and its paycheck deposit dates update as described in "Account changes update deposit dates"

#### Scenario: Hidden when the feature is off
- **WHEN** the `businessCalendars` experimental feature is off
- **THEN** the account menu does not offer "Business days", on desktop or narrow layouts

#### Scenario: Deleted calendar
- **WHEN** an account's business calendar is deleted
- **THEN** the account uses Saturday and Sunday as non-business days and the dialog says its calendar was deleted
