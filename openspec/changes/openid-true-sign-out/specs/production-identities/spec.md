# Spec Delta

## Purpose

Who may sign in to the hosted Actual servers, how they sign in and out through the shared identity provider, where their credentials live, and how their actions are attributed.

## ADDED Requirements

### Requirement: Sign-out ends the identity provider session
When a user chooses "Sign out" and their session came from OpenID, Actual SHALL end its own session on the server and then send the browser that holds the provider session to the provider's logout, so the next "Sign in with OpenID" starts at the provider's username step. This SHALL hold on desktop web, Electron, the phone UI and the mobile app.

#### Scenario: Desktop web asks who is signing in
- **GIVEN** a user signed in through OpenID in a desktop browser
- **WHEN** they choose "Sign out" from the user menu and then press "Sign in with OpenID"
- **THEN** the provider asks for a username, not only for the previous account's second factor

#### Scenario: Electron asks who is signing in
- **GIVEN** a user signed in through OpenID in the Electron app, whose sign-in ran in the system browser
- **WHEN** they choose "Sign out" and then press "Sign in with OpenID"
- **THEN** the provider logout opens in the system browser, the app shows Actual's sign-in page, and the next sign-in asks for a username

#### Scenario: Phone UI asks who is signing in
- **GIVEN** a user signed in through OpenID at phone width
- **WHEN** they choose "Sign out" from the user menu on the budget list and then press "Sign in with OpenID"
- **THEN** the provider asks for a username

#### Scenario: Mobile app asks who is signing in
- **GIVEN** a user signed in through OpenID in the mobile app
- **WHEN** they choose "Sign out" from the user menu on the budget list and then press "Sign in with OpenID"
- **THEN** the provider asks for a username

#### Scenario: A different user signs in right after
- **GIVEN** user A has just signed out on desktop, Electron, the phone UI or the mobile app
- **WHEN** user B presses "Sign in with OpenID" and enters their own username
- **THEN** user B is signed in as user B and sees only user B's budgets

#### Scenario: Sign-out lands on Actual's sign-in page
- **WHEN** the provider finishes its logout
- **THEN** the browser returns to Actual and shows the sign-in page, not a provider page

### Requirement: The provider logout address comes from discovery, with an Auth0 fallback
The server SHALL build the provider logout address from the discovery document's `end_session_endpoint`. When discovery has none and the issuer is an Auth0 domain, it SHALL use that domain's `/v2/logout` with the server's client id and return URL. When neither applies, sign-out SHALL end Actual's session only and the server SHALL log a warning.

#### Scenario: Discovery names an end-session endpoint
- **GIVEN** the provider's discovery document has `end_session_endpoint`
- **WHEN** an OpenID user signs out
- **THEN** the browser is sent to that endpoint with the server's client id and the return URL as `post_logout_redirect_uri`

#### Scenario: Auth0 without an end-session endpoint
- **GIVEN** the issuer is an Auth0 domain and its discovery document has no `end_session_endpoint`
- **WHEN** an OpenID user signs out
- **THEN** the browser is sent to that domain's `/v2/logout` with the server's client id and the return URL as `returnTo`

#### Scenario: A provider with no logout
- **GIVEN** the provider is not Auth0 and its discovery document has no `end_session_endpoint`
- **WHEN** an OpenID user signs out
- **THEN** Actual's session ends, the browser shows Actual's sign-in page, and the server logs a warning that the provider session was left open

### Requirement: The return URL is the server's own address
The provider SHALL return the browser to the server's base URL, derived from the server's configured OpenID hostname. The return URL SHALL NOT come from the client's request, so a sign-out cannot be turned into a redirect to another site.

#### Scenario: Staging and production each return home
- **GIVEN** staging and production share one Auth0 tenant and each has its own sync app
- **WHEN** a user signs out of staging, and later of production
- **THEN** staging returns to staging's base URL and production to production's, each with its own client id

#### Scenario: A request cannot choose the return URL
- **WHEN** a sign-out request carries another return address
- **THEN** the server ignores it and uses its own base URL

### Requirement: A failed provider logout never leaves the user signed in
Actual's session SHALL be deleted on the server and the client's token and keys removed before the browser is sent to the provider. Any failure after that point (the provider unreachable, an error page, a rejected return URL) SHALL leave the user signed out of Actual.

#### Scenario: The provider is unreachable
- **GIVEN** an OpenID user signs out and the provider logout cannot be reached
- **WHEN** the user returns to Actual
- **THEN** Actual shows its sign-in page and the old session token is refused by the server

#### Scenario: Discovery fails during sign-out
- **GIVEN** the server cannot fetch the provider's discovery document
- **WHEN** an OpenID user signs out
- **THEN** the server still deletes the session, answers without a provider logout address, and the browser shows Actual's sign-in page

#### Scenario: The server is unreachable during sign-out
- **GIVEN** the client cannot reach the server
- **WHEN** the user signs out
- **THEN** the client removes its token and keys and shows the sign-in page, as it does today

### Requirement: Only an explicit sign-out leaves the provider
Leaving the provider session SHALL happen only when the user chooses "Sign out". Automatic sign-outs (an expired or revoked session, changing the server, losing access to a page) and sessions from password login SHALL end Actual's session only.

#### Scenario: An expired session does not visit the provider
- **WHEN** the server reports the session expired and the client signs out
- **THEN** the browser stays in Actual and shows the sign-in page

#### Scenario: A password session does not visit the provider
- **GIVEN** a session from password login
- **WHEN** the user chooses "Sign out"
- **THEN** the server answers without a provider logout address and the browser shows Actual's sign-in page
