# Spec Delta

## Purpose

The native SwiftUI Budget tab on iPhone (ADR 11, sc-3593). It reads a month through the `native-bridge` handler `native/budget-month` and writes only through allowlisted loot-core handlers. The web Budget screen is unchanged and stays the Budget screen on the desktop, in browsers and on Android. The screen is iPhone-only; there is no desktop scenario because ADR 11 makes native screens Apple-only.

## ADDED Requirements

### Requirement: The native Budget tab has a per-screen switch and a web fallback
The iOS app SHALL show the native Budget tab only while a per-screen switch is on. The switch SHALL default to off, and Settings in the iOS app SHALL offer it. While it is off, the Budget tab SHALL show the web Budget screen exactly as before. While it is on, the tab SHALL show the current month of an envelope budget, read-only: every group and category with its budgeted, spent and balance, and to-budget. A bridge call that fails or times out SHALL show an error state with a retry.

#### Scenario: Switch on
- **GIVEN** an envelope budget open in the iOS app and the switch on
- **WHEN** the user opens the Budget tab
- **THEN** the tab shows the native current month, and its numbers equal the web Budget screen's for the same budget and month

#### Scenario: Switch off
- **GIVEN** the switch is turned off
- **WHEN** the user opens the Budget tab
- **THEN** the web Budget screen is shown

#### Scenario: Default
- **GIVEN** a fresh install of the iOS app
- **WHEN** the user opens the Budget tab
- **THEN** the web Budget screen is shown, and Settings offers the switch

#### Scenario: Tracking budget before tracking support lands
- **GIVEN** the switch is on and the open budget is a tracking budget, before the tracking requirement below is built
- **WHEN** the user opens the Budget tab
- **THEN** the web Budget screen is shown (the fallback), not a blank or an error

#### Scenario: The read times out
- **GIVEN** the switch is on and the engine does not answer
- **WHEN** the tab loads its month
- **THEN** after the client timeout the tab shows an error state with a retry, instead of an empty or endless spinner

### Requirement: The native Budget tab navigates between months
The native Budget tab SHALL offer previous month, next month and a month picker. Each month SHALL be one `native/budget-month` read. Months outside the budget's range SHALL NOT be reachable. The visible month SHALL survive leaving the tab and returning to it.

#### Scenario: Step back three months
- **GIVEN** the native Budget tab showing the current month
- **WHEN** the user steps to the previous month three times
- **THEN** the tab shows that month's numbers, and they equal the web screen's for the same month

#### Scenario: Month outside the range
- **GIVEN** the native Budget tab showing the budget's first month
- **WHEN** the user looks for an earlier month
- **THEN** previous month is unavailable and the picker offers no earlier month

#### Scenario: Leaving and returning
- **GIVEN** the native Budget tab showing a month other than the current one
- **WHEN** the user opens another tab and comes back
- **THEN** the tab shows the same month

### Requirement: Budgeted amounts are edited through loot-core
On an envelope month the user SHALL be able to tap a category's budgeted amount, type a new one and save. The native side SHALL call the allowlisted `budget/budget-amount` handler and then re-read the month. A save SHALL give a haptic. A failed save SHALL show an error and keep the old value. Native code SHALL NOT open the budget database, write CRDT messages or store a computed total.

#### Scenario: Edit an amount
- **GIVEN** the native Budget tab on an envelope month
- **WHEN** the user saves a new budgeted amount for a category
- **THEN** the tab re-reads the month, its numbers equal the web screen's for the same budget, and the web screen shows the edit

#### Scenario: The save fails
- **GIVEN** the native Budget tab on an envelope month
- **WHEN** a save fails or times out
- **THEN** an error shows and the category keeps its old budgeted amount

#### Scenario: Only valid ids and months are sent
- **GIVEN** the native Budget tab showing a month
- **WHEN** the user edits a category
- **THEN** native code sends only a category id and a month from the last decoded snapshot, and an amount that is an integer in the budget's minor units; an invalid value is never sent

#### Scenario: Writes stay inside loot-core
- **GIVEN** the native Budget tab and the bridge allowlist
- **WHEN** native code writes anything or calls a handler that is not allowlisted
- **THEN** the write goes through an allowlisted loot-core handler or is refused, and the native-Swift check still passes (no database import, no stored totals)

### Requirement: Tracking budgets render and edit like envelope budgets
On a tracking budget the native Budget tab SHALL show the tracking layout (to-budget absent, the tracking totals shown) from the same `native/budget-month` shape, and SHALL edit budgeted amounts through `budget/budget-amount`. The layout SHALL follow the budget type in the month snapshot and not a stored preference. Together with the envelope requirements above, envelope and tracking budgets SHALL both render and edit correctly, matching the web screen's numbers for the same budget.

#### Scenario: Open a tracking budget
- **GIVEN** a tracking budget open in the iOS app with the switch on
- **WHEN** the user opens the Budget tab
- **THEN** the tab shows the tracking layout, with no to-budget, and its numbers equal the web screen's for the same month

#### Scenario: Edit on a tracking budget
- **GIVEN** the native Budget tab on a tracking budget
- **WHEN** the user saves a new budgeted amount
- **THEN** the tab re-reads the month, its numbers equal the web screen's, and the web screen shows the edit

#### Scenario: A budget switched between modes
- **GIVEN** a budget switched from envelope to tracking, or back, on the web
- **WHEN** the native tab next reads the month
- **THEN** it shows the layout of the type in the snapshot

### Requirement: Money is moved between categories and to-budget
On an envelope month the native Budget tab SHALL offer a Move money sheet: pick a source and a destination (a category or to-budget), enter an amount and confirm. The native side SHALL call the allowlisted `budget/transfer-category` or `budget/transfer-available` handler and then re-read the month. A success SHALL give a haptic. The sheet SHALL NOT be offered on a tracking month.

#### Scenario: Move from to-budget to a category
- **GIVEN** the native Budget tab on an envelope month with money in to-budget
- **WHEN** the user moves 10 dollars from to-budget to a category and confirms
- **THEN** the category's budgeted amount and to-budget show the move, and equal the web screen's afterwards

#### Scenario: Move between two categories
- **GIVEN** the native Budget tab on an envelope month
- **WHEN** the user moves an amount from one category to another and confirms
- **THEN** both categories show the moved amount and equal the web screen's afterwards

#### Scenario: Tracking month
- **GIVEN** the native Budget tab on a tracking budget
- **WHEN** the user looks for Move money
- **THEN** it is not offered

#### Scenario: Writes stay allowlisted
- **GIVEN** the Move money sheet
- **WHEN** the user confirms a move
- **THEN** the native side uses only allowlisted handlers

### Requirement: The Budget tab re-reads on change events and respects the background
The native Budget tab SHALL subscribe to `cells-changed` and `sync-event` through the bridge and re-read the visible month, at most once per frame; a burst of writes need not collapse to a single read. Every bridge call SHALL use the client timeout (about 5 seconds) and handle the timeout error. The tab SHALL NOT read through the bridge while the app is in the background, and SHALL re-read the visible month when the app returns to the foreground.

#### Scenario: A change from another writer
- **GIVEN** the native Budget tab showing a month
- **WHEN** a budgeted amount for that month changes from the web side or another writer
- **THEN** the tab refreshes through the change event and shows the new number

#### Scenario: A burst of changes
- **GIVEN** the native Budget tab showing a month
- **WHEN** several change events arrive within one frame
- **THEN** the tab re-reads at most once for that frame

#### Scenario: Timeout is handled
- **GIVEN** the engine is suspended and does not answer
- **WHEN** the tab makes a bridge call
- **THEN** the call fails with the timeout error and the tab shows its error state

#### Scenario: Background and foreground
- **GIVEN** the native Budget tab open when the app goes to the background
- **WHEN** a change event arrives in the background, and the app then returns to the foreground
- **THEN** the tab made no bridge read in the background and re-reads the visible month on returning

### Requirement: A real sync reaches the native Budget tab
A change made on another device SHALL reach the native Budget tab through `sync-event`, and the tab SHALL re-read. This SHALL be shown on a device against staging with a repeatable test whose evidence is recorded on the story, because the bridge spike (sc-3584) could not exercise a real sync.

#### Scenario: Another device changes an amount
- **GIVEN** the TestFlight build on Ken's iPhone, signed in to staging, with the native Budget tab showing a month
- **WHEN** a second client changes a budgeted amount in that month and syncs
- **THEN** the iPhone receives `sync-event`, the tab re-reads, and the new amount shows; the steps, the observed refresh and the timings are recorded on the story

#### Scenario: A defect in sync-event forwarding
- **GIVEN** the device test above
- **WHEN** the screen does not refresh
- **THEN** a small fix lands in the same slice, or a bug story is filed, and the requirement stays unmet until it passes

### Requirement: The Budget tab works with Dynamic Type, Dark Mode and VoiceOver
Every control of the native Budget tab, including groups, categories, the edit field and the Move money sheet, SHALL work with Dynamic Type up to the largest accessibility sizes, in light and dark appearance, and with VoiceOver. Amounts SHALL NOT truncate and SHALL use tabular digits. Colours SHALL be the semantic colours of `native-appearance`. VoiceOver SHALL read each control's label, value and trait, in a sensible focus order.

#### Scenario: Largest accessibility size
- **GIVEN** the largest Dynamic Type accessibility size
- **WHEN** the native Budget tab shows a category with a large amount
- **THEN** the amount is complete and not truncated, and no control is cut off

#### Scenario: Dark Mode
- **GIVEN** the native Budget tab open in light appearance
- **WHEN** the device switches to dark appearance
- **THEN** the tab switches without a restart, with legible text and amounts

#### Scenario: VoiceOver on a category
- **GIVEN** VoiceOver on and the focus on a category row
- **WHEN** VoiceOver reads it
- **THEN** it speaks the category name, its budgeted, spent and balance, and that the budgeted amount can be edited

#### Scenario: VoiceOver in the Move money sheet
- **GIVEN** VoiceOver on and the Move money sheet open
- **WHEN** the user moves through it
- **THEN** each field and button has a label, a value and a trait, in reading order

### Requirement: A 300-category month meets the latency target
On a 300-category month, one `native/budget-month` round trip SHALL complete in under 50 ms median (the bridge spike's target), and scrolling the whole month SHALL show no frame that takes longer than 33 ms to render (a dropped frame at 60 Hz). The median and the 95th percentile SHALL be recorded on the story, from the Simulator and then from Ken's iPhone. If the target cannot be met, work SHALL stop and be reported to the Director, so ADR 11 is revisited.

#### Scenario: Render and scroll a big month
- **GIVEN** a 300-category budget open in the iOS app with the switch on
- **WHEN** the native Budget tab loads and the user scrolls through all of it
- **THEN** the month renders within the target and no scrolled frame takes longer than 33 ms, and the median and p95 are recorded on the story

#### Scenario: The target is missed
- **GIVEN** the measurement above
- **WHEN** the median exceeds 50 ms after the lazy-list, diffing and single-read fixes
- **THEN** work stops and the Director is told, so ADR 11 is revisited
