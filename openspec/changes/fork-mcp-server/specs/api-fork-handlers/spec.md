# Spec Delta

## ADDED Requirements

### Requirement: Typed API methods for the fork's handlers
`@actual-app/api` SHALL export a typed method for each of the 14 handlers the fork adds beyond upstream's (paychecks, account business days, move on budget and its preview, and business calendars), so a script needs no untyped `internal.send` call. Each SHALL call its handler with the arguments unchanged and return its result with the same errors, and its argument and result types SHALL be written by hand and checked against the handlers by the compiler through `send`.

#### Scenario: A script edits a paycheck
- **GIVEN** a budget with the paycheck "Acme", whose schedules the API refuses to edit
- **WHEN** a script calls `updatePaycheck` with a new deposit amount
- **THEN** the paycheck's definition changes and its schedules are regenerated, as when the app saves it

#### Scenario: Move on budget through the API
- **GIVEN** an open off-budget account "Vanguard 401k"
- **WHEN** a script calls `previewMoveAccountOnBudget` and then `moveAccountOnBudget` with the same start date
- **THEN** the preview changes nothing, and the move produces the result the app's move produces

#### Scenario: Errors are the handler's errors
- **WHEN** a script calls `moveAccountOnBudget` for an account that is already on budget
- **THEN** the call rejects with the handler's error, not a wrapper's

### Requirement: Every fork handler has a method
The API tests SHALL fail, naming the handler, when any of the 14 listed handlers has no typed method or `methods.ts` does not call it. The list is fixed in the test; a new fork handler is found by `mcp-server` "Coverage check", which also requires its call in `methods.ts`.

#### Scenario: A handler without a method
- **GIVEN** a listed fork handler `paycheck-skip-next` whose method is removed from `methods.ts`
- **WHEN** the API tests run
- **THEN** a test names `paycheck-skip-next` as missing
