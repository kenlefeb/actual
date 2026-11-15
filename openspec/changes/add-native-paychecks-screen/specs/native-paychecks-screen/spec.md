# Spec Delta

## Purpose

The SwiftUI Schedules & Paychecks screens in the native Apple apps: the Budget-tab summary row, the list, and the paycheck editor on iPhone, and the window and editor sheet on Mac. They show and change only what loot-core computes.

## ADDED Requirements

### Requirement: The native paychecks screens have a per-screen switch and a web fallback
A per-device switch, off by default, SHALL choose between the native Schedules & Paychecks screens and the existing web screens. With it off, the Budget tab SHALL have no summary row, and Schedules SHALL open the web screens unchanged. Flipping the switch SHALL need no data migration and lose no saved edit.

#### Scenario: Switch off on iPhone
- **GIVEN** the switch is off
- **WHEN** the user opens Schedules from Settings
- **THEN** the web Schedules screen shows, and the Budget tab has no summary row

#### Scenario: Switch on on iPhone
- **GIVEN** the switch is on and the paychecks feature is on
- **WHEN** the user opens the Budget tab
- **THEN** the summary row shows above the budget, and tapping it opens the native list

#### Scenario: Switch off on Mac
- **GIVEN** the Mac app with the switch off
- **WHEN** the user picks Schedules & Paychecks in the sidebar
- **THEN** the web screens show

### Requirement: The Budget tab shows a paycheck summary row
While the switch and the paychecks feature are on, the Budget tab SHALL show a summary row above the budget. The row SHALL show the next paycheck date, that paycheck's net pay, and the number of schedules the list shows. Every value SHALL come from loot-core. Net pay SHALL use the incoming-only money colour.

#### Scenario: Paychecks set up
- **GIVEN** "Acme" pays 2,400.00 net on Friday November 27 and "Side gig" pays on December 5, and the list shows 6 schedules
- **WHEN** the user opens the Budget tab
- **THEN** the row shows November 27, 2,400.00 and 6 schedules, the same values the web Paychecks section shows for that budget

#### Scenario: No paychecks
- **GIVEN** a budget with no paychecks
- **WHEN** the user opens the Budget tab
- **THEN** the row shows a prompt to add a paycheck, and no zero amounts or dates

#### Scenario: Every paycheck ended
- **GIVEN** every paycheck's pay schedule has ended
- **WHEN** the user opens the Budget tab
- **THEN** the row shows "none upcoming"

#### Scenario: The paychecks feature is off
- **GIVEN** the switch is on and the paychecks feature is off
- **WHEN** the user opens the Budget tab
- **THEN** there is no summary row, and Schedules opens the web screens

#### Scenario: Back from the list
- **GIVEN** the Budget tab scrolled down on March 2027
- **WHEN** the user opens the list from the row and goes back
- **THEN** the Budget tab shows March 2027 at the same scroll position

### Requirement: The summary row reflects clearing warnings
When any paycheck has an active clearing-account warning, the summary row SHALL show a warning mark and text, not colour alone.

#### Scenario: A clearing warning
- **GIVEN** the "Acme" clearing account holds 2,400.00 three business days after its deposits were due
- **WHEN** the user opens the Budget tab
- **THEN** the row shows a warning mark with text saying a paycheck needs attention

### Requirement: The native list shows paychecks then schedules
The native list SHALL show the paychecks first, in the web's order. Each paycheck SHALL show its next date, net pay, deposits with their dates, any skipped dates, and any clearing warning. The schedules follow, each with a status word. A paycheck's own schedules SHALL NOT appear among the schedules. Values SHALL equal the web screens' for the same budget.

#### Scenario: A paycheck row
- **GIVEN** "Acme" deposits 400.00 to Savings and the rest to Checking, the next pay date is Saturday November 28, the clearing account's calendar is weekends only, and the paycheck moves weekend dates earlier
- **WHEN** the user opens the native list
- **THEN** the "Acme" row shows Friday November 27, the net pay, and each deposit with its amount and expected date, as the web row does

#### Scenario: Generated schedules are hidden
- **GIVEN** "Acme" generated the "Acme" pay schedule and the "Acme → Savings" deposit schedule
- **WHEN** the user views the schedules in the native list
- **THEN** neither appears, and every other schedule shows with a status word such as "Upcoming" or "Missed"

#### Scenario: A skipped paycheck
- **GIVEN** the user skipped Acme's November 14 pay date
- **WHEN** the user opens the native list
- **THEN** the "Acme" row shows a skipped line for November 14 and the next date after it

#### Scenario: Show more
- **WHEN** the user taps "Show more" on a paycheck
- **THEN** the next three pay dates after the next one show, each with its deposits, from the same read

#### Scenario: Empty list
- **GIVEN** a budget with no paychecks and no schedules
- **WHEN** the user opens the native list
- **THEN** each section shows its own empty text and an add action: add paycheck opens the native editor, and add schedule opens the web schedule form

#### Scenario: On Mac
- **GIVEN** the same budget in the Mac app with the switch on
- **WHEN** the user opens the Schedules & Paychecks window
- **THEN** the paycheck cards show the same values, and the schedules table lists the same schedules, sortable by each column with the sort state announced by VoiceOver and kept across re-reads

### Requirement: Skip next asks before it skips
"Skip next" SHALL open a confirmation whose confirm button uses the normal teal accent (one swappable token), not destructive styling. Confirming SHALL skip the paycheck's next pay date and every deposit's, through loot-core, then re-read the list. Cancelling SHALL change nothing. A failed skip SHALL show an error and leave the list unchanged.

#### Scenario: Confirm a skip
- **WHEN** the user taps "Skip next" on "Acme" and confirms
- **THEN** Acme's next date moves to the following pay date, and the list shows the skipped line

#### Scenario: Cancel a skip
- **WHEN** the user taps "Skip next" and cancels
- **THEN** nothing changes

#### Scenario: A failed skip
- **GIVEN** the engine does not answer within the bridge timeout
- **WHEN** the user confirms a skip
- **THEN** an error shows and the list keeps its values

### Requirement: Native writes offer Undo briefly
After a successful skip, save or delete, the screen SHALL offer Undo briefly. Undo SHALL reverse that write as one step, through loot-core's undo. The offer SHALL be withdrawn when it times out, on any change event, on any other write, or when the user leaves the screen. Undo SHALL never be offered at any other time.

#### Scenario: Undo a skip
- **WHEN** the user skips "Acme" and taps Undo while it is offered
- **THEN** Acme's next date and its deposits' dates are back where they were

#### Scenario: Undo a save
- **GIVEN** the user saved "Acme" with a new deposit and a changed days-early value
- **WHEN** they tap Undo while it is offered
- **THEN** the paycheck, its schedules and the account's days-early value are all back as they were

#### Scenario: Something else changed first
- **GIVEN** Undo is offered after a skip
- **WHEN** a sync brings in a change before the user taps it
- **THEN** the Undo offer is gone, and nothing is undone

### Requirement: The paycheck editor is a full-height sheet
On iPhone, creating or editing a paycheck SHALL open a full-height sheet with cancel and save. The sheet SHALL have the web editor's sections in the same order, each collapsible, with a days-early stepper and a "post automatically" switch. Net pay stays pinned and visible at every Dynamic Type size. On Mac, the editor SHALL be a sheet attached to the window.

#### Scenario: Net pay stays visible
- **WHEN** the user edits deductions with the deposits section collapsed
- **THEN** the pinned net pay updates after each change to the value loot-core computes for the draft

#### Scenario: Cancel with changes
- **GIVEN** the user changed a deduction
- **WHEN** they tap cancel
- **THEN** the sheet asks before discarding, and keeps the edit if they decline

#### Scenario: Keyboard on Mac
- **GIVEN** the Mac editor sheet with valid input
- **WHEN** the user presses Return
- **THEN** it saves, and Escape cancels, asking first if there are unsaved changes

### Requirement: The editor validates through loot-core
The editor SHALL show the same validation results as the web form for the same draft, worked out by loot-core. Each error SHALL show next to its field and be announced by VoiceOver. Save SHALL be disabled while the draft is invalid or a save is running.

#### Scenario: Deductions exceed gross
- **GIVEN** a gross pay of 2,000.00
- **WHEN** the user enters deductions of 2,100.00
- **THEN** the deductions field shows the same message the web form shows, VoiceOver announces it, and save is disabled

#### Scenario: Clearing account as a deposit
- **WHEN** the user picks the clearing account as a deposit account
- **THEN** the deposit shows "A deposit cannot go to the clearing account."

### Requirement: Saving a paycheck is all or nothing
Save SHALL write the paycheck, its schedules and every changed days-early value in one loot-core write that either fully applies or changes nothing. The sheet SHALL close only on success. A rejected save SHALL show loot-core's message and keep the draft.

#### Scenario: A rejected save
- **GIVEN** another schedule is already named "Acme → Savings"
- **WHEN** the user saves "Acme" with a Savings deposit and a new days-early value for Savings
- **THEN** the sheet stays open with the message, and neither the paycheck nor Savings' days-early value changed

#### Scenario: Saved on two devices
- **GIVEN** the paycheck was changed on another device since the sheet opened
- **WHEN** the user saves
- **THEN** the result follows the paychecks spec's "Edits on two devices" scenarios, and the list re-reads

### Requirement: The editor shows year-to-date from loot-core
The editor SHALL show the year-to-date totals loot-core reports for the paycheck. A paycheck with no posted pay SHALL show an empty state, not zeros.

#### Scenario: History
- **GIVEN** "Acme" posted three pay transactions this year
- **WHEN** the user opens Acme in the editor
- **THEN** gross, deductions and net for this year and last equal the web editor's

#### Scenario: No history
- **GIVEN** a paycheck with no posted pay
- **WHEN** the user opens it
- **THEN** the year-to-date section shows its empty state

### Requirement: The paychecks screens re-read on change events and foreground
The summary row, list and editor data SHALL re-read on change events that touch paychecks, schedules, transactions, accounts or preferences, coalesced, and when the app returns to the foreground. A failed or slow read SHALL keep the last values and show the Budget screen's refresh-failure messages.

#### Scenario: A change on another device
- **GIVEN** the native list is open
- **WHEN** a sync brings in a new deposit on "Acme"
- **THEN** the list re-reads once and shows the deposit

#### Scenario: A timed-out read
- **GIVEN** the list shows values
- **WHEN** a re-read times out
- **THEN** the last values stay, with the refresh-failure message

### Requirement: The paychecks screens work with Dynamic Type, Dark Mode and VoiceOver
The screens SHALL reflow, without clipping dates or amounts, up to the largest accessibility text size. They SHALL follow Dark Mode. VoiceOver SHALL read each paycheck row, and the summary row, as one element. Their actions SHALL be exposed as custom actions.

#### Scenario: The summary row in VoiceOver
- **WHEN** VoiceOver focuses the summary row
- **THEN** it reads "Next paycheck, November 27, 2,400.00, 6 schedules; opens Schedules and Paychecks"

#### Scenario: Largest text size
- **GIVEN** the largest accessibility text size
- **WHEN** the user opens the list and the editor
- **THEN** no date or amount is truncated, and net pay stays pinned in the editor

#### Scenario: Mac keyboard only
- **GIVEN** the Mac window
- **WHEN** the user works with the keyboard only
- **THEN** they can reach the sidebar item, the cards, the table rows and every sheet field in section order
