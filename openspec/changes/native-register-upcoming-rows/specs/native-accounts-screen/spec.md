## ADDED Requirements

### Requirement: Upcoming rows show what will post
The native register on iPhone SHALL show each upcoming scheduled row as it will post to this account: payee, category, amount, notes and split count after the schedule's rules, the account's own rows, and transfers into it inverted per line with the other account's name. It SHALL show the rows and numbers loot-core returns, with no rule logic or arithmetic in Swift. Unfiltered and within the horizon cap, the rows SHALL equal the web register's.

#### Scenario: A rule sets the category
- **GIVEN** a schedule whose rule sets the category "Utilities"
- **WHEN** the user opens the account's register on iPhone
- **THEN** the upcoming row shows "Utilities", as the web register does

#### Scenario: A split line into this account
- **GIVEN** a split schedule on Checking with one line of 200.00 transferring to Savings
- **WHEN** the user opens the Savings register
- **THEN** one upcoming row shows +200.00 from Checking, and no other line of the split

#### Scenario: The schedule's own split
- **GIVEN** the same split schedule
- **WHEN** the user opens the Checking register
- **THEN** one upcoming row shows "Split (n)" with the schedule's amount

### Requirement: Upcoming rows follow scope and search
On iPhone, a scope chip or search SHALL show the upcoming rows the posted row would match and hide the rest, by the same predicate as posted rows. Upcoming rows stay above the posted rows and grey, marked "Scheduled". This differs from the web, which hides them while filtered.

#### Scenario: Uncleared
- **GIVEN** an upcoming row and a cleared posted row
- **WHEN** the user taps Uncleared
- **THEN** the upcoming row shows and the cleared row does not

#### Scenario: Search hit and miss
- **GIVEN** upcoming rows for "Netflix" and "Rent"
- **WHEN** the user searches "netflix"
- **THEN** only the Netflix upcoming row shows among upcoming rows

#### Scenario: Uncategorized
- **GIVEN** an upcoming row with no category after rules, and one whose rule sets a category
- **WHEN** the user taps Uncategorized
- **THEN** only the first shows

### Requirement: Upcoming rows have their own count and total
While any filter is active, the iPhone register SHALL show the upcoming rows' count and total apart from the posted results ("N scheduled" with its total), using loot-core's `upcomingCount` and `upcomingTotal`, and SHALL never add upcoming amounts to the posted results' total.

#### Scenario: A search matching both
- **GIVEN** a search matching 3 posted rows and 1 upcoming row
- **WHEN** the results show
- **THEN** the list says 3 results with their total, and 1 scheduled with its total

### Requirement: The register says when the cap hides scheduled rows
When loot-core reports that the horizon cap hid upcoming rows, the iPhone register SHALL say so below the upcoming rows: "Scheduled rows shown up to N days; change this in Settings > Limits.", with N from loot-core. It SHALL say nothing when no row was hidden.

#### Scenario: A schedule beyond the cap
- **GIVEN** a schedule length of 6 months and the default cap of 92 days
- **WHEN** the user opens the register
- **THEN** the notice says scheduled rows are shown up to 92 days and points to Settings > Limits

#### Scenario: Nothing hidden
- **GIVEN** the default upcoming length of 1 week
- **WHEN** the user opens the register
- **THEN** no notice shows

### Requirement: An upcoming row opens a read-only detail
Tapping an upcoming row on iPhone SHALL open a native read-only detail with its date, payee, category, amount, account and the word "Scheduled", and, when rules changed any field, "Fields set by rules:" with those fields' names from loot-core. It SHALL offer no edit and no web hand-off; editing schedules is story 4617.

#### Scenario: A row a rule changed
- **GIVEN** an upcoming row whose rule set the payee and category
- **WHEN** the user taps it
- **THEN** the detail shows "Scheduled" and "Fields set by rules: payee, category", and nothing can be edited

#### Scenario: A row no rule changed
- **WHEN** the user taps an upcoming row whose rules changed nothing
- **THEN** the detail shows "Scheduled" and no "Fields set by rules" line

### Requirement: The cap is a labelled limit in Settings
The Limits section of native Settings (story 4643) SHALL list `accounts-register-upcoming-max-days` with the label "Scheduled rows: days ahead" and text saying it caps the budget's upcoming scheduled length in the native register, with its value, default 92 and ceiling 366, as for every limit there.

#### Scenario: Changing the cap
- **GIVEN** the Limits section of native Settings
- **WHEN** the user sets "Scheduled rows: days ahead" to 200 and reopens a register whose schedule length is 6 months
- **THEN** scheduled rows up to 200 days ahead show, and the notice says 200 days
