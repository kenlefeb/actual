# Spec Delta

## ADDED Requirements

### Requirement: The iPhone app recovers its own page when the page's process ends
When iOS ends the page's process, the iPhone app SHALL reload its own start page, never the address the web view last showed. After three automatic reloads within a minute it SHALL stop reloading and show an alert with a Reload button; pressing it SHALL reload the start page and start the count again.

#### Scenario: The process ends on a used sign-in callback
- **GIVEN** the web view last showed a one-time sign-in callback address
- **WHEN** the page's process ends
- **THEN** the app loads its own start page, and the callback address is not requested again

#### Scenario: The process ends on an ordinary screen
- **GIVEN** a budget is open
- **WHEN** the page's process ends
- **THEN** the app loads its own start page and the page reopens the budget

#### Scenario: The process keeps ending
- **GIVEN** the app reloaded its page three times within a minute
- **WHEN** the process ends again
- **THEN** the app does not reload and shows the alert

#### Scenario: The person presses Reload
- **GIVEN** the alert is showing
- **WHEN** the person presses Reload
- **THEN** the app loads its start page, and later ends of the process are counted from zero
