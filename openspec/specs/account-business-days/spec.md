# account-business-days Specification

## Purpose
Lets each account carry the business calendar of the institution behind it and how many business days early its direct deposits arrive, so paycheck dates follow each employer's and bank's own days.

## Requirements

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

### Requirement: Early direct deposits
An account SHALL have a number of business days early that direct deposits arrive, a whole number from 0 to 10, defaulting to 0. Each paycheck deposit to the account is dated that many business days, in the account's calendar, before the pay date. With 0, the deposit is on the pay date, or the nearest earlier business day of the account's calendar when the pay date is not one.

#### Scenario: Two business days early
- **GIVEN** "Checking" uses "U.S. Federal Reserve" and deposits arrive 2 business days early
- **WHEN** a paycheck's pay date is Friday, November 13, 2026
- **THEN** its deposit to "Checking" is Tuesday, November 10, 2026, because Wednesday, November 11 is Veterans Day

#### Scenario: Same-day deposits on a bank holiday
- **GIVEN** "Savings" uses "U.S. Federal Reserve" and deposits arrive 0 business days early
- **WHEN** a paycheck's pay date is Monday, October 12, 2026, which the employer works but the Federal Reserve observes as Columbus Day
- **THEN** its deposit to "Savings" is Friday, October 9, 2026

#### Scenario: Invalid number of days
- **WHEN** the user enters a number of days that is negative, fractional or more than 10
- **THEN** the dialog does not save it and says the number must be a whole number from 0 to 10

### Requirement: Account changes update deposit dates
Changing an account's calendar or early-deposit days SHALL update the dates of every paycheck deposit to that account, including their upcoming dates and stored next dates. Undo SHALL restore both the account setting and the deposit dates.

#### Scenario: Bank changes its early-deposit policy
- **GIVEN** a paycheck deposits to "Checking", which deposits arrive 2 business days early
- **WHEN** the user changes "Checking" to 1 business day early
- **THEN** the deposit's upcoming dates move one business day later

#### Scenario: Undo an account change
- **WHEN** the user undoes that change
- **THEN** "Checking" is 2 business days early again and the deposit's dates return
