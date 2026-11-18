# Spec Delta

## ADDED Requirements

### Requirement: The Mac Budget window shows the budget months read-only
On the Mac (the iPhone has the Budget tab), the native Budget window SHALL show, for an envelope or tracking budget, every group and category with budgeted, spent and balance, and to-budget, in a dense table of 1 to 3 months side by side, as many as the window fits (Figma "Budget — Mac"). Every number SHALL come from `native/budget-month`; a failed or timed-out read SHALL show an error with a retry.

#### Scenario: Envelope budget
- **GIVEN** an envelope budget open in the Mac app with the native Budget window on
- **WHEN** the window shows a month
- **THEN** its numbers equal the web Budget screen's and the iPhone Budget tab's for the same budget and month

#### Scenario: Tracking budget
- **GIVEN** a tracking budget open in the Mac app
- **WHEN** the window shows a month
- **THEN** it shows the tracking layout with the web screen's numbers

#### Scenario: The read times out
- **GIVEN** the engine does not answer
- **WHEN** the window loads a month
- **THEN** after the client timeout it shows an error with a retry

### Requirement: The Mac Budget window navigates months from the keyboard
The Mac Budget window SHALL move one month back or forward with Command-Left and Command-Right, return to this month with Command-T, and offer the same in the toolbar and the Budget menu, within the budget's month range, reading each newly shown month once through `native/budget-month`.

#### Scenario: Next month from the keyboard
- **GIVEN** the window showing months that do not end at the last month in range
- **WHEN** the user presses Command-Right
- **THEN** the window shifts one month, and only the newly shown month is read

#### Scenario: Back to this month
- **GIVEN** the window showing months in the past
- **WHEN** the user presses Command-T
- **THEN** the window shows the current month again

#### Scenario: At the end of the range
- **GIVEN** the window showing the last month in range
- **WHEN** the user presses Command-Right
- **THEN** nothing is read and the month stays

### Requirement: The Mac Budget window has a switch to its web screen
The Mac app SHALL offer a switch, persisted per Mac, between the native Budget window and the web Budget screen in the same window. It SHALL default to native. While it is off, the web Budget screen SHALL show exactly as in a browser.

#### Scenario: Switch off
- **GIVEN** a budget open in the Mac app
- **WHEN** the user turns the native Budget switch off
- **THEN** the web Budget screen shows, and stays after a relaunch until the switch is turned on

### Requirement: The Mac Budget window re-reads on change events
The Mac Budget window SHALL re-read its visible months once per burst of `cells-changed` or `sync-event` events, and when the app becomes active or the Mac wakes, and SHALL NOT read while the app is inactive.

#### Scenario: A change from another device
- **GIVEN** the window open and another device changes a budgeted amount for a shown month
- **WHEN** the app syncs
- **THEN** the window shows the new amount without a manual refresh

### Requirement: The Mac Budget window works with Dark Mode, keyboard and VoiceOver
The Mac Budget window SHALL follow the system appearance, SHALL be fully usable from the keyboard (move between cells, edit, move money, change month), and SHALL give VoiceOver a real table with row and column headers, read each cell with its category, month, column and meaning (for example "overspent"), and announce the new to-budget after a change.

#### Scenario: VoiceOver on a category row
- **GIVEN** VoiceOver on and the window showing a month
- **WHEN** focus reaches a category row
- **THEN** VoiceOver reads the category, month, column and amount, and "overspent" for a negative balance

#### Scenario: Dark Mode
- **GIVEN** the Mac in Dark Mode
- **WHEN** the window shows a month
- **THEN** it uses the system dark appearance with readable amounts

### Requirement: Budgeted amounts are edited inline on the Mac
On the Mac, the user SHALL edit a Budgeted cell inline. Return SHALL save through `budget/budget-amount` with the iPhone's validation and re-read the month; Tab and Shift-Tab SHALL save and move to the next or previous month; Escape SHALL cancel. Simple arithmetic SHALL work as on the web. Command-Z SHALL undo the last native edit. A failed save SHALL keep the old value and show the error.

#### Scenario: Save an amount
- **GIVEN** an envelope month in the Mac Budget window
- **WHEN** the user types a new budgeted amount for a category and presses Return
- **THEN** loot-core saves it, the month is re-read, and the web screen shows the same amount

#### Scenario: Arithmetic and Tab
- **GIVEN** a Budgeted cell being edited with 50
- **WHEN** the user types 50+25 and presses Tab
- **THEN** 75 is saved for that month and the same category's next-month cell starts editing

#### Scenario: Undo
- **GIVEN** a budgeted amount just saved in the Mac window
- **WHEN** the user presses Command-Z
- **THEN** the previous amount is restored through loot-core and the month is re-read

#### Scenario: A failed save
- **GIVEN** the engine refuses or does not answer the save
- **WHEN** the user presses Return
- **THEN** the previous amount stays and the error shows

### Requirement: Money is moved and overspending covered on the Mac
On an envelope budget, clicking a balance (or Return on it) SHALL open a popover to move money to another category or to-budget; on an overspent balance it SHALL cover the overspending from a chosen source. It SHALL use the iPhone's rules and handlers (`budget/transfer-category`, `budget/transfer-available`) and re-read the month. Tracking budgets SHALL NOT offer it.

#### Scenario: Move money between categories
- **GIVEN** a category with a positive balance on an envelope month
- **WHEN** the user moves part of it to another category in the popover
- **THEN** loot-core moves it, both balances update after the re-read, and the web screen agrees

#### Scenario: Cover overspending
- **GIVEN** an overspent category on an envelope month
- **WHEN** the user clicks its balance and confirms the pre-filled amount from a source
- **THEN** the category's balance is no longer negative after the re-read

#### Scenario: Tracking budget
- **GIVEN** a tracking budget in the Mac window
- **WHEN** the user clicks a Remaining amount
- **THEN** no move-money popover opens and the Budget menu has no Move Money item
