## ADDED Requirements

### Requirement: Upcoming rows show what will post
The native register on iPhone SHALL show each upcoming scheduled row as it will post to this account: payee, category, amount, notes and split count after the schedule's rules, the account's own rows, and transfers into it inverted per line with the other account's name. It SHALL show the rows and numbers loot-core returns, with no rule logic or arithmetic in Swift. Unfiltered and within the day and row caps, the rows SHALL equal the web register's.

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

### Requirement: A capped count and total say they are partial
When loot-core returns `upcomingMore`, the iPhone register SHALL label the count and total as partial: "Nearest K scheduled; more not shown", with K (`upcomingKept`, occurrences kept) from loot-core, and the total labelled as those nearest rows' total. It SHALL never show a count of all scheduled occurrences, which loot-core does not compute.

#### Scenario: Capped, unfiltered
- **GIVEN** 4,600 scheduled occurrences and the default row cap of 100
- **WHEN** the user opens the register
- **THEN** the upcoming section says "Nearest 100 scheduled; more not shown" and its total is labelled as the nearest rows' total

#### Scenario: Capped and searched
- **GIVEN** the same account and a search matching 2 of the nearest 100
- **WHEN** the results show
- **THEN** the section says 2 scheduled in the nearest 100, more not shown or searched, with those 2 rows' total

#### Scenario: Not capped
- **GIVEN** 12 scheduled previews
- **WHEN** the user opens the register
- **THEN** the section says "12 scheduled" with no "Nearest" wording

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

### Requirement: The register does not wait for upcoming rows
The iPhone register SHALL show its header and posted rows without waiting for upcoming rows, then fill the upcoming section from `native/account-upcoming`, showing "Loading scheduled…" while a first, scope or search read is in flight. A reply for an older scope, search, account or write SHALL be dropped. A failed read SHALL keep the posted rows usable and show "Couldn't load scheduled rows. Try again." with Retry, which re-reads the upcoming section only.

#### Scenario: Upcoming rows arrive later
- **GIVEN** an upcoming read that answers after the register read
- **WHEN** the user opens the register
- **THEN** the posted rows show first, the upcoming section says "Loading scheduled…", then fills in

#### Scenario: A stale reply
- **GIVEN** the user types "rent" and then "rental" before the first upcoming reply arrives
- **WHEN** both replies arrive, the older one last
- **THEN** the upcoming section shows the "rental" rows only

#### Scenario: The upcoming read fails
- **WHEN** `native/account-upcoming` fails
- **THEN** the posted rows stay usable, and the upcoming section shows "Couldn't load scheduled rows. Try again." with Retry

#### Scenario: Retry
- **GIVEN** the failed section
- **WHEN** the user taps Retry and the read succeeds
- **THEN** only the upcoming section is read again, and it fills in

### Requirement: Upcoming rows refresh after a write
After a write or change event that changes posted rows or schedules, the iPhone register SHALL re-run the upcoming read and keep the old upcoming rows at the same height, dimmed and marked "Updating…" (count and total too, announced to VoiceOver), until the new reply replaces them. A reply from before the write SHALL be dropped. If the new read fails, the section SHALL show the failure state with Retry.

#### Scenario: Categorize a row
- **GIVEN** the register with upcoming rows shown
- **WHEN** the user categorizes a posted row
- **THEN** the upcoming rows stay at the same height marked "Updating…", the posted rows do not move, and the new reply replaces them

#### Scenario: A late reply from before the write
- **GIVEN** an upcoming read in flight when the user categorizes a posted row
- **WHEN** that older reply arrives after the write
- **THEN** it is dropped, and the rows stay marked "Updating…" until the newer reply

#### Scenario: The refresh fails
- **WHEN** the upcoming read after a write fails
- **THEN** the "Updating…" rows are replaced by "Couldn't load scheduled rows. Try again." with Retry

#### Scenario: A schedule changed elsewhere
- **WHEN** a sync brings a schedule change
- **THEN** the upcoming section is read again, its rows marked "Updating…" meanwhile

### Requirement: Updating rows open only the read-only detail
While upcoming rows are marked "Updating…", tapping one SHALL open its read-only detail, also marked "Updating…", and nothing else; the rows offer no swipe or action that depends on fresh data. "Loading scheduled…" SHALL stay for the first load and for a scope or search change.

#### Scenario: Tap an updating row
- **GIVEN** upcoming rows marked "Updating…"
- **WHEN** the user taps one
- **THEN** its read-only detail opens marked "Updating…", and no swipe action is offered

#### Scenario: A search change
- **WHEN** the user changes the search
- **THEN** the upcoming section shows "Loading scheduled…" until the reply

### Requirement: The register says when the row cap hides scheduled rows
When loot-core returns `upcomingMore`, the iPhone register SHALL say below the upcoming rows: "More scheduled rows are not shown or searched; change this in Settings > Limits.", and nothing otherwise.

#### Scenario: Fifty daily schedules
- **GIVEN** an upcoming read returning `upcomingMore` true
- **WHEN** the user opens the register
- **THEN** the notice says more scheduled rows are not shown or searched and points to Settings > Limits

### Requirement: The cap is a labelled limit in Settings
The Limits section of native Settings (story 4643) SHALL list `accounts-register-upcoming-max-days` as "Scheduled rows: days ahead" (it caps the budget's upcoming scheduled length in the native register; default 92, ceiling 366) and `accounts-upcoming-max-rows` as "Scheduled rows: most shown" (default 100, ceiling 500), each with its value, default and ceiling, as for every limit there.

#### Scenario: Changing the cap
- **GIVEN** the Limits section of native Settings
- **WHEN** the user sets "Scheduled rows: days ahead" to 200 and reopens a register whose schedule length is 6 months
- **THEN** scheduled rows up to 200 days ahead show, and the notice says 200 days

#### Scenario: Changing the row cap
- **GIVEN** the Limits section of native Settings and an account with 150 upcoming previews
- **WHEN** the user sets "Scheduled rows: most shown" to 200 and reopens the register
- **THEN** all 150 show and no "more" notice shows
