# mobile-note-links Specification

## Purpose
Defines how web addresses in mobile transaction notes behave, so receipts and documents referenced in notes open directly from the transaction list.

## Requirements

### Requirement: Web addresses render as external links
On mobile, a web address in a transaction note SHALL be shown as a real link whose target is the normalized address.

#### Scenario: HTTPS address in a note
- **WHEN** a note contains `https://example.com/receipt.pdf`
- **THEN** the note preview shows a link to `https://example.com/receipt.pdf`

### Requirement: Opening a link does not open the transaction
Tapping a web link in a mobile note SHALL open the address in a new browser context and SHALL NOT open the surrounding transaction or leave the current list.

#### Scenario: Tap a receipt link in the transaction list
- **WHEN** a user taps a note link in the mobile transaction list
- **THEN** the address opens in a new tab or window
- **AND** the transaction editor does not open and the list stays at its current location
