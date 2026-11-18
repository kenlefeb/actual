# Spec Delta

## MODIFIED Requirements

### Requirement: The native Budget tab has a per-screen switch and a web fallback
The iOS app SHALL show the native Budget tab while a per-screen switch is on. The switch SHALL read on when it has never been set, and an explicit off SHALL be kept. Settings SHALL offer it. While it is off, the Budget tab SHALL show the web Budget screen exactly as before. A bridge call that fails or times out SHALL show an error state with a retry.

#### Scenario: Switch on
- **GIVEN** an envelope budget open in the iOS app and the switch on
- **WHEN** the user opens the Budget tab
- **THEN** the tab shows the native current month, and its numbers equal the web Budget screen's for the same budget and month

#### Scenario: Switch off
- **GIVEN** the switch is turned off
- **WHEN** the user opens the Budget tab
- **THEN** the web Budget screen is shown

#### Scenario: Default
- **GIVEN** a fresh install of the iOS app, or a device that never set the switch
- **WHEN** the user opens the Budget tab
- **THEN** the native Budget screen is shown, and Settings offers the switch to turn it off

#### Scenario: The read times out
- **GIVEN** the switch is on and the engine does not answer
- **WHEN** the tab loads its month
- **THEN** after the client timeout the tab shows an error state with a retry, instead of an empty or endless spinner
