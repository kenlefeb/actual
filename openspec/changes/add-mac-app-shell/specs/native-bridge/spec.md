# Spec Delta

## ADDED Requirements

### Requirement: The Mac app's expected origin is its own scheme
In the Mac app, the server URL the origin guard and page calls use SHALL be `homeeconomics://localhost`. A message or page call SHALL be accepted only from the main frame on that origin, so a sign-in page, the sync server's own web app or any other frame in the web view is refused.

#### Scenario: The app's page
- **GIVEN** the Mac app's page loaded from `homeeconomics://localhost` in the main frame
- **WHEN** native code makes a bridge call or the page posts a change event
- **THEN** the expected origin is `homeeconomics://localhost` and both are accepted

#### Scenario: The sign-in provider's page
- **GIVEN** the OpenID provider's page or the sync server's web app in the main frame during sign-in
- **WHEN** native code makes a bridge call or that page posts a message
- **THEN** the call is refused with the origin error and the message is ignored

### Requirement: Native budget writes can be undone by their token
`budget/budget-amount`, `budget/transfer-category` and `budget/transfer-available` SHALL accept an optional undo token from native code and record it as that undo step's marker, as paycheck writes do. `native/undo` with that token SHALL undo only that step. Web calls pass no token and are unchanged.

#### Scenario: Undo a native edit
- **GIVEN** a budgeted amount saved from the Mac window with a token
- **WHEN** native code calls `native/undo` with the same token
- **THEN** loot-core restores the previous amount

#### Scenario: A web edit came after
- **GIVEN** a native edit with a token, then a web edit
- **WHEN** native code calls `native/undo` with the native edit's token
- **THEN** the call fails with nothing to undo, and the web edit stays
