## ADDED Requirements

### Requirement: Upcoming rows show what will post
The native register (iPhone, and Mac through the shared `NativeBridgeCore` view model) SHALL show each upcoming scheduled row as it will post to this account: payee, category, amount, notes and split count after the schedule's rules, the account's own rows, and transfers into it inverted per line with the other account's name. It SHALL show the rows and numbers loot-core returns, with no rule logic or arithmetic in Swift. Unfiltered, the rows SHALL equal the web register's.

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
