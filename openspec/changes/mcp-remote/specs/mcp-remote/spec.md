# Spec Delta

## ADDED Requirements

### Requirement: A separate hosted entry
The hosted server SHALL be its own entry, apart from the stdio entry, that serves the same read tools over stateless streamable HTTP. It SHALL listen only on its configured address (loopback by default), and the stdio entry SHALL stay unchanged and listener-free.

#### Scenario: The stdio entry still opens no listener
- **WHEN** the `actual-mcp` stdio entry is running
- **THEN** it has no listening socket, as before

#### Scenario: The hosted entry serves the same read tools
- **WHEN** an authorized client lists the hosted entry's tools
- **THEN** it lists the read tools of the stdio entry and no other tool except `get_sync_status`

### Requirement: Hosted means read-only, in code
The hosted entry SHALL open the budget with `readOnly: true` unconditionally, SHALL never register a `write_` tool, and SHALL treat `--writes` or any write setting as a usage error. No configuration SHALL change this.

#### Scenario: A writes flag is refused
- **WHEN** the hosted entry is started with `--writes`
- **THEN** it exits with a fixed usage error and serves nothing

#### Scenario: A hosted sync writes nothing
- **GIVEN** an auto-post schedule that is due and paycheck edits that arrive by sync
- **WHEN** the hosted entry syncs
- **THEN** no transaction is created in its copy and nothing is pushed or uploaded

### Requirement: Staging only in v1
The hosted entry SHALL serve only an environment labelled `staging` or `local`, and SHALL refuse to start for a `production` host, including when the stdio entry's production override is set.

#### Scenario: Production is refused
- **GIVEN** `ACTUAL_SERVER_URL` names a host labelled `production` and `ACTUAL_MCP_ALLOW_PRODUCTION=1` is set
- **WHEN** the hosted entry starts
- **THEN** it exits with a fixed error before it signs in or listens

### Requirement: One budget per instance
A hosted instance SHALL serve exactly one budget of one environment, with its own credentials and data directory (`<env>-remote`, created with mode 0700 by the same checks as the stdio entry), because the engine holds one loaded budget per process.

#### Scenario: A second budget is a second instance
- **GIVEN** two budgets to expose
- **WHEN** they are configured
- **THEN** each runs as its own instance with its own data directory and credentials

### Requirement: Authenticated with OAuth
Every request to the MCP endpoint SHALL carry a valid access token from this server's OAuth 2.1 authorization-code flow with PKCE, bound to this server's resource URL and holding the scope `budget:read`. A request without one SHALL get a 401 that names the protected-resource metadata, and a token SHALL never be accepted in a URL.

#### Scenario: No token
- **WHEN** a client calls the endpoint without a token
- **THEN** it receives 401 with a `WWW-Authenticate` header pointing to the metadata, and no tool runs

#### Scenario: A token for another resource
- **GIVEN** a token issued for a different resource URL
- **WHEN** a client calls the endpoint with it
- **THEN** the call is refused with 401

#### Scenario: A token in the query string
- **WHEN** a client sends a valid token as a URL query parameter
- **THEN** the call is refused with 401

### Requirement: Short-lived, revocable tokens
Access tokens SHALL be short-lived (no more than one hour), and refresh tokens SHALL expire (no more than 30 days after issue) and be revocable. Revoking a refresh token SHALL stop it, and rotating the signing key SHALL invalidate every token at once.

#### Scenario: A revoked refresh token
- **GIVEN** a client holding a refresh token that has been revoked
- **WHEN** it asks for a new access token
- **THEN** the request is refused

#### Scenario: An expired refresh token
- **GIVEN** a refresh token issued 31 days ago
- **WHEN** a client asks for a new access token with it
- **THEN** the request is refused

#### Scenario: Rotating the signing key
- **GIVEN** a valid access token
- **WHEN** the signing key is rotated and the server restarted
- **THEN** that token is refused

### Requirement: Exactly one identity
The authorization step SHALL sign the user in through one configured upstream identity provider and SHALL accept exactly one configured account identifier. It SHALL NOT accept a sign-in by emailed link or code, and the provider SHALL be configuration (issuer, client settings, account), not a constant in code.

#### Scenario: Another account
- **GIVEN** a sign-in at the upstream provider by an account other than the configured one
- **WHEN** the authorization step completes
- **THEN** no code or token is issued

#### Scenario: The configured account
- **WHEN** the configured account signs in
- **THEN** the flow completes and issues a code for the requesting client

### Requirement: Clients are registered, not open
The server SHALL serve one pre-registered confidential client, SHALL NOT expose dynamic client registration unless it is turned on by configuration, and SHALL match a redirect URI exactly against a configured allowlist (by default the documented Claude callback). Dynamic registration, when on, SHALL be limited to that allowlist.

#### Scenario: A foreign redirect URI
- **WHEN** an authorization request names a redirect URI that is not on the allowlist
- **THEN** it is refused and no code is issued

#### Scenario: Registration is off by default
- **WHEN** a client calls the registration endpoint on a default configuration
- **THEN** the endpoint does not exist

### Requirement: Host, origin and rate checks
The hosted entry SHALL refuse a request whose `Host` is not on the configured public hostname list, SHALL refuse a request carrying a browser `Origin` that is not on a configured allowlist, and SHALL rate-limit the authorization, token, revocation and MCP endpoints, per endpoint and per client id. The per-endpoint limit SHALL be kept per endpoint and per source address, on every endpoint and with no shared counter, so one source cannot use up the limit for the signed-in user. The source is the client address that the local proxy sets in `X-Forwarded-For` (the last entry is read), trusted only from a loopback peer; the table of sources SHALL stay bounded. The per-client limit, not an aggregate cap, is what protects the engine, and there is no cap across sources. Where a loopback peer supplies no usable address the source SHALL be one shared `loopback` key, which brings back a shared limit, and the hosted entry SHALL record that (once per process, without the header value). The protection is not claimed to work until staging confirms the proxy supplies real client addresses.

#### Scenario: A rebinding host
- **WHEN** a request arrives with a `Host` that is not configured
- **THEN** it is refused before authentication

#### Scenario: A browser origin
- **WHEN** a request arrives with an `Origin` that is not allowed
- **THEN** it is refused

#### Scenario: One client over its limit
- **GIVEN** two clients, one of which exceeds its per-client limit
- **WHEN** both call the MCP endpoint
- **THEN** the first is refused with 429 and the second is served

#### Scenario: A flood
- **WHEN** a client sends more token requests than the limit in a minute
- **THEN** the extra requests are refused with 429

#### Scenario: A flood from one source spares another
- **GIVEN** one source has used up its limit on the authorization, token or revocation endpoint
- **WHEN** a second source calls the same endpoint
- **THEN** the second source is served and only the first is refused with 429

#### Scenario: A forged forwarded address
- **WHEN** a caller adds its own earlier `X-Forwarded-For` entries, or sends the header from a non-loopback peer
- **THEN** the limit is still keyed by the address the proxy appended, or by the peer address, so the caller cannot choose its own key

#### Scenario: No usable forwarded address
- **WHEN** a loopback peer calls an OAuth endpoint with a missing, empty or unparseable `X-Forwarded-For`
- **THEN** the request is keyed `loopback` and a `source-unresolved` record is written once, without the header value

#### Scenario: Many sources
- **WHEN** more distinct sources call than the table holds
- **THEN** the table keeps its bound by dropping the oldest source, and memory does not grow

### Requirement: Only configured upstreams
The hosted entry SHALL make outbound requests only to the configured sync server and the configured identity provider, and SHALL fetch no URL named in budget data.

#### Scenario: A URL in a note
- **GIVEN** a transaction note that contains a URL
- **WHEN** a client lists the transaction
- **THEN** the server makes no request to that URL

### Requirement: Secrets live in read-only files
The server SHALL read its Actual credential, optional encryption key and signing key from configured files, and refuse to start when one is missing or readable by more than its owner. The Actual credential is exactly one of `ACTUAL_PASSWORD_FILE` or a session token in `ACTUAL_SESSION_TOKEN_FILE` (mode 0400). No secret SHALL appear on a command line, in a URL, a log, an error or a tool result.

#### Scenario: A loose secret file
- **GIVEN** the signing key file has mode 0644
- **WHEN** the hosted entry starts
- **THEN** it exits with a fixed error that does not name the secret

#### Scenario: A session token instead of a password
- **GIVEN** `ACTUAL_SESSION_TOKEN_FILE` names a 0400 file and `ACTUAL_PASSWORD_FILE` is unset
- **WHEN** the hosted entry starts
- **THEN** it signs in to the sync server with the token

#### Scenario: A token file looser than 0400, or a password with it
- **GIVEN** the token file has mode 0600, or `ACTUAL_PASSWORD_FILE` is also set
- **WHEN** the hosted entry starts
- **THEN** it exits with a fixed error that does not name the secret

#### Scenario: Errors carry no secrets
- **GIVEN** the sync server rejects the credential
- **WHEN** a tool call fails
- **THEN** neither the response nor any log line contains the credential

### Requirement: The copy stays fresh
The hosted entry SHALL sync at start and on a configured interval (default five minutes), SHALL serialize those syncs with `sync_budget`, SHALL keep serving the last copy when a sync fails, and SHALL offer `get_sync_status` with the time of the last successful sync and whether the latest attempt failed.

#### Scenario: A failed sync
- **GIVEN** the sync server is unreachable
- **WHEN** a client calls `list_accounts` and then `get_sync_status`
- **THEN** the accounts come from the last copy, and the status shows the last success time and that the latest attempt failed

### Requirement: Access is recorded without data
The hosted entry SHALL record sign-ins, token issues, refreshes, revocations and refusals, and the name and status of each tool call, with the client id and time, and SHALL NOT record tokens, secrets, tool arguments or budget data.

#### Scenario: A tool call is recorded
- **WHEN** a client calls `list_payees` with a search term
- **THEN** the record holds the tool name, status, client id and time, and not the search term or any payee

### Requirement: Clients are supported only after they connect on staging
The connection checklist SHALL record, for each client (claude.ai, the mobile apps, Claude Duet), that it completed the OAuth flow and a tool call on staging before it is called supported, and SHALL settle these unverified assumptions there: which source addresses Anthropic's connector calls use and whether an edge allowlist is worth adding, the callback URL each client uses, and whether a pre-registered client is accepted.

#### Scenario: Duet is not assumed
- **GIVEN** nobody has connected Claude Duet to the staging instance
- **WHEN** the documentation is written
- **THEN** it does not claim Duet support, and lists the open items instead
