## ADDED Requirements

### Requirement: A statement balance is a human's record
An account SHALL have at most one statement balance record, a synced value with an integer-cent `amount`, a `source` of `bank-sync`, `statement`, `cleared` or `entered`, an optional `as_of` date, `entered_by` text, `entered_at`, a record `id` and `consumed_at`, saved only from the app. A new save SHALL replace the old record, unconsumed.

#### Scenario: The app records a balance
- **WHEN** the app saves 12,345 cents from the bank-sync source for an account
- **THEN** reading the account returns that amount and source, an `id` and `entered_at` set by the server, and `consumed_at` null

#### Scenario: A malformed record
- **WHEN** the stored value is not a valid record
- **THEN** reading the account returns no record

### Requirement: No API or MCP path records a balance
No handler under `api/` SHALL save or edit a statement balance record, so a script or an MCP tool cannot create one. Only the read and the consume SHALL be reachable through the API.

#### Scenario: The API handlers
- **WHEN** the API's handlers are listed
- **THEN** they include a read and a consume of the record, and none that saves one

### Requirement: Consuming a record is a compare-and-set
A consume SHALL set `consumed_at` only when the stored record's `id` equals the given `id` and it is unconsumed, and SHALL report whether it did.

#### Scenario: An older id
- **GIVEN** the app saved a newer record after the tool read the old one
- **WHEN** the tool consumes the old `id`
- **THEN** nothing is consumed and the newer record stays unconsumed

#### Scenario: A used record
- **WHEN** a consume is repeated for the same `id`
- **THEN** the second call consumes nothing and says so

### Requirement: A record is usable until it expires or is used
A record SHALL be usable by the MCP tool only while unconsumed, no older than the expiry setting and not from the `cleared` source. The expiry SHALL default to 168 hours, be set only by the operator, and not exceed an operator ceiling of 720 hours.

#### Scenario: Expired
- **GIVEN** an expiry of 168 hours and a record entered 169 hours ago
- **THEN** its status is `expired`

#### Scenario: A cleared echo
- **WHEN** the record's source is `cleared`
- **THEN** its status is `echo` and it is not usable

#### Scenario: A bad setting
- **WHEN** the expiry setting is zero, not a whole number or above the ceiling
- **THEN** the server refuses to start with fixed text
