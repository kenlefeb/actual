## ADDED Requirements

### Requirement: The reconcile handlers are allowlisted
The bridge allowlist SHALL add `native/reconcile-month`, `native/reconcile-rows`, `native/reconcile-tick`, `native/reconcile-list-set`, `account-statement-balance-prefill`, `account-statement-balance-save` and `account-statement-balance-get`, and the native chrome SHALL accept a `presentReconcile` message only from the app's own page. No other handler SHALL join the list.

#### Scenario: An allowlisted reconcile read
- **WHEN** native code calls `native/reconcile-month`
- **THEN** loot-core runs it and native receives the checklist

#### Scenario: A message from another page
- **WHEN** a frame outside the app's origin posts `presentReconcile`
- **THEN** it is ignored
