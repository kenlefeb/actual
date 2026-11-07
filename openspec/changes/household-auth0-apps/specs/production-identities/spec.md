# Spec Delta

## ADDED Requirements

### Requirement: Each household has its own Auth0 application pair
Every household SHALL have one sync application and one MCP connector application in the shared Auth0 tenant. No client id SHALL be used by two households, and a household's sync and MCP applications SHALL be different applications. The household check SHALL refuse a set of household files that breaks this.

#### Scenario: A second household reuses a client id
- **GIVEN** household `ken` uses sync client id A
- **WHEN** a new household file also names A as its sync or MCP client id
- **THEN** the household check fails and names both households and the shared id

#### Scenario: One application serves both roles
- **WHEN** a household file names the same client id for its sync and MCP applications
- **THEN** the household check fails

### Requirement: A household's server accepts only its own application's sign-ins
A household's sync server SHALL accept an OpenID sign-in only when the ID token's audience includes that server's own sync client id, and, when the audience lists more than one party, its `azp` equals that client id. A household's MCP connector SHALL accept only ID tokens issued to its own connector application.

#### Scenario: A token from another household's sync app
- **GIVEN** household B's server is configured with its own sync client id
- **WHEN** a sign-in finishes with an ID token whose audience is household A's sync client id
- **THEN** B's server refuses it, creates no user and issues no session

#### Scenario: A multi-audience token authorized for another app
- **GIVEN** household B's server is configured with its own sync client id
- **WHEN** a sign-in finishes with an ID token whose audience is a list that includes B's client id but whose `azp` is another client id
- **THEN** B's server refuses it and creates no user

#### Scenario: A token from another household's connector app
- **GIVEN** household B's MCP connector is configured with its own connector client id
- **WHEN** its OAuth callback receives an ID token issued to household A's connector application
- **THEN** it refuses the sign-in and issues no MCP token

### Requirement: The household lead administers only that household's server
Each household's `admin_subject` SHALL be its lead's Auth0 `sub`, so the first sign-in, and ADMIN, on that server is the lead's. A lead SHALL have no user on any other household's server, and Ken SHALL have no user on a household's server unless that household's lead adds him.

#### Scenario: The lead's first sign-in
- **GIVEN** a new household's server with no OpenID user and `admin_subject` set to the lead's `sub`
- **WHEN** the lead signs in through the household's sync app
- **THEN** the lead becomes ADMIN and owner of that server

#### Scenario: A lead signs in to another household's server before its lead has
- **GIVEN** household B's server has no OpenID user yet and its `admin_subject` is B's lead
- **WHEN** household A's lead finishes a sign-in on B's server
- **THEN** B's server refuses it by `admin_subject`, creates no user and issues no session

#### Scenario: A lead signs in to another household's server
- **GIVEN** household B's server already has users and A's lead is not in its user list
- **WHEN** A's lead finishes a sign-in on B's server
- **THEN** B's server refuses it and creates no user

#### Scenario: The tenant administrator is not a household administrator
- **GIVEN** Ken runs the tenant and is not in household B's user list
- **WHEN** Ken signs in on B's server
- **THEN** B's server refuses it

### Requirement: Switching households asks who is signing in
Moving from one household's server to another's in the same browser or app SHALL go through the provider's username step, by the requirement "Sign-out ends the identity provider session" (change `openid-true-sign-out`, sc-2684). Each household's sync application SHALL list that household's server base URL as an allowed logout URL.

#### Scenario: Sign out of one household, sign in to another
- **GIVEN** a user signed in to household A's server on desktop web, Electron, the phone UI or the mobile app
- **WHEN** they choose "Sign out", point the client at household B's server and press "Sign in with OpenID"
- **THEN** the provider asks for a username, and B's server admits only a user in B's list

#### Scenario: Each household returns to its own server
- **WHEN** a user signs out of household B's server
- **THEN** the provider returns the browser to B's base URL, which B's sync application lists as an allowed logout URL
