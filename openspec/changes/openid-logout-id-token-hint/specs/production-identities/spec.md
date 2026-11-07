# Spec Delta

## Purpose

Who may sign in to the hosted Actual servers, how they sign in and out through the shared identity provider, where their credentials live, and how their actions are attributed.

## ADDED Requirements

### Requirement: Sign-out skips the provider's confirmation page
When an OpenID session ends through "Sign out", the server SHALL add the session's ID token as `id_token_hint` to the provider logout address built from discovery's `end_session_endpoint`, so the provider ends its session without asking the user to confirm. The server SHALL keep the ID token only with its session and SHALL NOT send it to the client except inside that address. This SHALL hold on desktop web, Electron, the phone UI and the mobile app.

#### Scenario: Desktop sign-out has no confirmation page
- **GIVEN** a user signed in through OpenID after this change, on desktop web or Electron
- **WHEN** they choose "Sign out" from the user menu
- **THEN** the provider does not ask "Are you sure?", the browser returns to Actual's sign-in page, and the next "Sign in with OpenID" asks for credentials

#### Scenario: Phone and mobile app sign-out has no confirmation page
- **GIVEN** a user signed in through OpenID after this change, at phone width or in the mobile app
- **WHEN** they choose "Sign out" from the user menu on the budget list
- **THEN** the provider does not ask "Are you sure?", the app shows Actual's sign-in page, and the next "Sign in with OpenID" asks for credentials

#### Scenario: A session from before the change still signs out
- **GIVEN** an OpenID session created before this change, with no stored ID token
- **WHEN** the user chooses "Sign out" on desktop, at phone width or in the mobile app
- **THEN** the provider logout address carries no `id_token_hint`, the provider may ask the user to confirm as before, and the user ends on Actual's sign-in page

#### Scenario: The ID token goes with the session
- **WHEN** a session ends for any reason (sign-out, expiry, the user disabled or deleted, the sign-in method changed)
- **THEN** its stored ID token is deleted with it

#### Scenario: The ID token stays on the server
- **GIVEN** a signed-in OpenID session with a stored ID token
- **WHEN** the client calls any route other than sign-out
- **THEN** no response contains the ID token, and the server does not write it to its logs
