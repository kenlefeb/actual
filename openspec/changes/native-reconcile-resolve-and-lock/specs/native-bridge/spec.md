## ADDED Requirements

### Requirement: The step 3 and 4 handlers are allowlisted and native only
The bridge allowlist SHALL add `native/reconcile-matches`, `native/reconcile-lock-preview`, `native/reconcile-adjust` and `native/reconcile-lock`, and `native/reconcile-rows` SHALL accept a `search` argument. No handler under `api/` SHALL lock an account's rows or create an adjustment.

#### Scenario: An allowlisted lock preview
- **WHEN** native code calls `native/reconcile-lock-preview`
- **THEN** loot-core returns the rows, partners and digest

#### Scenario: The API
- **WHEN** the API's handlers are listed
- **THEN** none locks rows or creates a reconciliation adjustment
