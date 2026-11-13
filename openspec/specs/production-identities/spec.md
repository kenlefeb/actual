# production-identities Specification

## Purpose
Who may sign in to the hosted Actual servers, how they sign in and out through the shared identity provider, where their credentials live, and how their actions are attributed.

## Requirements

### Requirement: The iOS app signs in and out inside the app
In the iOS app, signing in through OpenID and signing out SHALL keep the user in the app's own copy of Actual. After the provider's sign-out returns to the server's address, the app SHALL show its own sign-in screen, not the server-hosted web app.

#### Scenario: Sign in, then sign out, in the iOS app
- **GIVEN** the iOS app is connected to a server that uses OpenID
- **WHEN** the user signs in with "Sign in with OpenID", sees their budgets, and then chooses "Sign out" from the user menu on the budget list
- **THEN** the provider's sign-in and sign-out pages open inside the app, and after sign-out the app shows its own sign-in screen, from which the next "Sign in with OpenID" goes through the provider again
