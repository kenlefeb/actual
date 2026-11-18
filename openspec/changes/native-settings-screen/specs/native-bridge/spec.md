## ADDED Requirements

### Requirement: Settings are one local read
`native/settings` SHALL return, in one message and without network calls, the budget preferences native Settings shows, the budget's name and ids, whether it is encrypted, the server address and signed-in state, the fork client version (added by the page) and every configurable limit as its id, value, default and ceiling.

#### Scenario: Reading settings
- **GIVEN** a budget with `numberFormat` set and `accounts-register-page-size` set to 120
- **WHEN** native code calls `native/settings`
- **THEN** the result holds that number format, the limit with value 120, default 50 and ceiling 200, and the client version

#### Scenario: The shape changes
- **GIVEN** the contract fixture checked by vitest and decoded by the Swift tests
- **WHEN** the handler's output shape changes
- **THEN** the vitest contract test fails, and the Swift decode test fails against the regenerated fixture

#### Scenario: Offline
- **GIVEN** the server is unreachable
- **THEN** `native/settings` still answers within the latency gate

### Requirement: Server info has its own deadline
`native/server-info` SHALL return whether the server answered and its version, waiting at most the limit `server-info-timeout-seconds` (default 5, ceiling 30). An unreachable server SHALL return reachable false and no version, not an error.

#### Scenario: Unreachable
- **GIVEN** a server that does not answer
- **WHEN** native code calls `native/server-info`
- **THEN** it returns reachable false and version null within 5 seconds

### Requirement: The settings save is validated and undoable
`native/settings-save` SHALL accept only keys from a closed list (the native Settings preferences and the limit ids), each value from its closed set or, for a limit, a whole number from 1 to its ceiling or null to reset. Anything else SHALL fail the whole call with `[native:invalid-setting]` and write nothing. A save SHALL be one undo step; preferences are last write wins, so undo SHALL not check for later changes.

#### Scenario: Unknown key
- **WHEN** native code saves `{csv-mappings-x: "…"}`
- **THEN** the call fails with `[native:invalid-setting]` and nothing changes

#### Scenario: Limit over its ceiling
- **WHEN** native code saves `accounts-write-max-ids` as 900, 0, 1.5 or "100"
- **THEN** the call fails with `[native:invalid-setting]` and nothing changes

#### Scenario: Reset
- **GIVEN** `accounts-register-page-size` is 120
- **WHEN** native code saves it as null
- **THEN** the preference is removed and the next read shows value 50

#### Scenario: Budget type
- **WHEN** native code saves `budgetType` tracking
- **THEN** the preference is stored and the budget's computed values are rebuilt in the same call, as the web does

### Requirement: The settings handlers are allowlisted with listed fields
The bridge SHALL allowlist `native/settings`, `native/server-info` and `native/settings-save` in both the page list and the Swift list, which SHALL be equal. The page SHALL forward only `changes` and `undoToken` for the save and nothing for the reads. `preferences/save`, `save-global-prefs`, `subscribe-sign-out`, `set-server-url`, `key-make` and `reset-budget-cache` SHALL stay refused for native callers.

#### Scenario: A raw handler
- **WHEN** native code calls `preferences/save`
- **THEN** the bridge refuses it and nothing is written

#### Scenario: An extra field
- **WHEN** native code sends `native/settings-save` with an extra field
- **THEN** the page drops that field before loot-core

### Requirement: The settings handlers meet the latency gate
On a seed with 2,000 preference rows and every limit set, the median loot-core time of `native/settings` and of a `native/settings-save` of one preference SHALL be under 50 ms.

#### Scenario: The perf suite
- **WHEN** the native perf suite runs in Fork CI
- **THEN** both measurements print their median and p95, and the job fails if either median is 50 ms or more

### Requirement: Settings hand-offs are a closed set
The chrome SHALL accept `webSettingsAction` only from the app's own page and only with an action from the closed list: `language`, `budgets`, `sync-server`, `encryption`, `users`, `bank-sync`, `business-calendars`, `experimental`, `export`, `reset-cache`, `repair`, `notifications`, `sign-out`. Any other message SHALL be ignored.

#### Scenario: Unknown action
- **WHEN** the chrome receives `webSettingsAction` with action `delete-budget`
- **THEN** it ignores the message and nothing opens

#### Scenario: Foreign page
- **WHEN** a page from another origin sends `webSettingsAction` with action `sign-out`
- **THEN** it is ignored
