## ADDED Requirements

### Requirement: A held sync says it is waiting
While a sync is held back because local storage has not finished, the status line SHALL read "Waiting for this device to finish saving", through any retries, with no "Synced", "Syncing…" or "Sync failed" for that hold. It SHALL return to its normal text when the wait clears.

#### Scenario: Storage still writing
- **WHEN** sync ends with `storage-slow`
- **THEN** the status reads "Waiting for this device to finish saving"

#### Scenario: The wait clears
- **GIVEN** that status
- **WHEN** a later sync succeeds
- **THEN** the status reads "Synced"
