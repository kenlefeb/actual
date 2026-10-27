# Spec Delta

## Purpose

Defines the persistent synchronization status and control shown on narrow layouts, so mobile users always know whether their changes have reached the server.

## ADDED Requirements

### Requirement: Persistent status on narrow layouts
Narrow layouts SHALL always show a status line describing the budget's sync state: local file, syncing, offline, sync failed, synced, or server online.

#### Scenario: Server reachable before any sync
- **WHEN** the server is online and no sync has completed yet
- **THEN** the status reads "Server online"

#### Scenario: Local-only budget
- **WHEN** the budget has no sync server or syncing is disabled
- **THEN** the status reads "Local file — not syncing"

### Requirement: Synced only after a completed sync
The status SHALL report "Synced" only after a sync has completed successfully, never merely because the server is reachable, and SHALL show "Syncing…" while a sync is in progress.

#### Scenario: Sync in progress and completed
- **WHEN** a sync starts and later succeeds
- **THEN** the status reads "Syncing…" during the sync and "Synced" afterwards

### Requirement: Sync control
The status line SHALL offer a sync control that is disabled while syncing and hidden for local-only budgets.

#### Scenario: Control during sync
- **WHEN** a sync is in progress
- **THEN** the sync control is disabled, and it is enabled again when the sync ends

#### Scenario: Local-only budget
- **WHEN** the budget is local-only
- **THEN** no sync control is shown

### Requirement: Failures stay visible and retryable
Offline and failed-sync outcomes SHALL remain visible until a later sync outcome replaces them, with the sync control available to retry.

#### Scenario: Network error
- **WHEN** a sync fails because the network is unavailable
- **THEN** the status reads "Offline — changes saved on this device" and the sync control is enabled

#### Scenario: Sync error
- **WHEN** a sync fails for a non-network reason
- **THEN** the status reads "Sync failed — try again"

### Requirement: Completed sync results override offline launch
After the app launches offline, completed sync results SHALL replace the cached offline state.

#### Scenario: Reconnect after offline launch
- **WHEN** the app starts offline and a sync later succeeds
- **THEN** the status changes from offline to "Synced"

### Requirement: Refresh recovers from failure
A pull-to-refresh sync SHALL clear its busy indicator when the sync fails, so the user can try again.

#### Scenario: Rejected refresh
- **WHEN** a pull-to-refresh sync fails
- **THEN** the refresh indicator stops and another refresh can be started
