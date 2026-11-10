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

### Requirement: Production only under an explicit guard
The hosted entry SHALL serve a `production` host only when the dedicated flag `ACTUAL_MCP_REMOTE_PRODUCTION=1` is set, the credential is a session token file, the allowed account is a provider subject identifier (no `@`) and the data directory is `production-remote`; otherwise it SHALL exit with a fixed error before it signs in or listens. The stdio entry's `ACTUAL_MCP_ALLOW_PRODUCTION` SHALL NOT satisfy the flag, and production SHALL stay read-only in code.

#### Scenario: Production without the flag
- **GIVEN** `ACTUAL_SERVER_URL` names a host labelled `production` and only `ACTUAL_MCP_ALLOW_PRODUCTION=1` is set
- **WHEN** the hosted entry starts
- **THEN** it exits with a fixed error before it signs in or listens

#### Scenario: Production with a password
- **GIVEN** the production flag is set and `ACTUAL_PASSWORD_FILE` is set instead of a session token
- **WHEN** the hosted entry starts
- **THEN** it exits with a fixed error that does not name the secret

#### Scenario: Production with an email as the account
- **GIVEN** the production flag and a session token are set and the allowed account is an email address
- **WHEN** the hosted entry starts
- **THEN** it exits with a fixed error

#### Scenario: Production with the guard met
- **GIVEN** the flag, a 0400 session token file, a subject identifier as the account and every other required setting
- **WHEN** the hosted entry starts
- **THEN** it serves the production budget through the read tools only, with `readOnly: true` and no write tool

#### Scenario: Production writes stay impossible
- **GIVEN** the production guard is met
- **WHEN** the hosted entry is started with `--writes`
- **THEN** it exits with the usage error and serves nothing

### Requirement: Production identity
A production instance SHALL sign users in only through its own application (client id, secret and callbacks) in the shared Auth0 tenant (Ken's decision of 2026-11-04: one tenant for staging and production), SHALL accept exactly one account, the assistant's provider subject identifier (for Auth0, its `auth0|...` `sub`), and SHALL NOT be configured with the staging client or account.

#### Scenario: A staging client on production
- **GIVEN** the production flag and a client id or account that equals the staging instance's
- **WHEN** the deployment review compares the two configurations
- **THEN** the review fails and the instance is not deployed

#### Scenario: A staging user on production
- **GIVEN** a staging test user in the shared tenant, who can reach the production application at the provider, so the allowed `sub` is what keeps them out
- **WHEN** that user finishes a sign-in at the production connector application
- **THEN** the connector refuses it because the user's subject is not the allowed account

### Requirement: The allowed production account is not the administrator's
The administrator's account, which holds the budget's ADMIN role, SHALL NOT be the allowed account, and no credential of the allowed account SHALL be held by any agent.

#### Scenario: The administrator signs in
- **GIVEN** a production instance whose allowed account is the assistant's subject
- **WHEN** the administrator's account signs in at the production application
- **THEN** no code or token is issued

### Requirement: A production token is never an administrator's
In production the hosted entry SHALL validate the session token against the sync server at start and SHALL exit with a fixed error, before it listens, unless the token's user holds exactly the BASIC permission (so ADMIN, any other permission, a missing permission, and a token that cannot be validated all exit). The guard's other conditions SHALL NOT be treated as proof of the token's privilege.

#### Scenario: An administrator's token
- **GIVEN** the production guard is met and the token file holds Ken's ADMIN token
- **WHEN** the hosted entry starts
- **THEN** it exits with a fixed error that does not name the token, and serves nothing

#### Scenario: A token without the BASIC permission
- **GIVEN** the sync server validates the token and its user holds neither ADMIN nor BASIC, or no permission at all
- **WHEN** the hosted entry starts in production
- **THEN** it exits with a fixed error and serves nothing

#### Scenario: A token that cannot be validated
- **GIVEN** the sync server rejects or does not answer the validation
- **WHEN** the hosted entry starts in production
- **THEN** it exits with a fixed error

#### Scenario: A loopback label with a public listener
- **GIVEN** `ACTUAL_SERVER_URL` is a loopback host (labelled `local`) and the listener is not loopback
- **WHEN** the hosted entry starts
- **THEN** it exits with a fixed error, so a loopback forward to a production server cannot skip the production checks

### Requirement: Production network and exposure
A production instance SHALL run on its own Docker network reaching only the production sync server and the identity provider (the shared Auth0 tenant), with its own node, hostname and tailnet tag (reaching only the sync server, no inbound but Funnel), hardened as staging is, never on the host network or with `docker.sock`, a shared network or production's loopback. Its egress SHALL be limited by an enforced, reboot-proof rule using hostnames, not IP rules for the CDN-fronted tenant.

#### Scenario: The network check
- **WHEN** the deployment review runs `docker inspect` on the production container
- **THEN** its network mode is not `host`, it is on only its dedicated network, it publishes no port on the host, it mounts no `docker.sock`, and it runs as a non-root uid

#### Scenario: A tailnet host other than the sync server
- **WHEN**, from inside the production container, a connection is opened to a tailnet host other than the production sync server
- **THEN** it is refused, while Funnel still serves inbound requests

#### Scenario: Egress to anything else
- **WHEN**, from inside the production container, a connection is opened to the internet at large, a private address, a tailnet address other than the production sync server, or the Docker bridge gateway
- **THEN** it fails, while the production sync server and the identity provider still work

### Requirement: Production prerequisites before go-live
A production instance SHALL NOT be deployed or connected until each is recorded as done: the per-source limit proven through the exposure layer (sc-2278); the aggregate ceiling (sc-2265); the egress rule (sc-2203); uid-owned secret files; the OpenID backstop and roles (`production-identities`); the account split (sc-2069); a revocation drill on staging; and the image's source commit and digest.

#### Scenario: The ceiling must not lock Ken out
- **GIVEN** a flood from many sources
- **WHEN** the signed-in user signs in
- **THEN** the aggregate ceiling does not refuse the sign-in; if no global number can meet this, the /48 (IPv6) or /24 (IPv4) tier is used instead

#### Scenario: A prerequisite is missing
- **GIVEN** the egress restriction is not in place
- **WHEN** the production deployment is reviewed
- **THEN** the review does not approve it

#### Scenario: The data copy stays in the container
- **WHEN** the production container is removed
- **THEN** its data directory, readable only by the container's uid, is removed with it

#### Scenario: Snapshots and the data directory
- **WHEN** the deployment is reviewed
- **THEN** it states whether VPS snapshots or backups include the container's data directory, and a plaintext production copy in an offsite snapshot fails the review

#### Scenario: The data-directory name is not proof
- **WHEN** the deployment review runs `docker inspect`
- **THEN** the data mount is checked to be the container's own volume, in addition to the `production-remote` name

#### Scenario: A secret file owned by root
- **GIVEN** the production session token is owned by root and the container runs as another uid
- **WHEN** the container starts
- **THEN** it exits with a fixed error, and the runbook does not proceed

### Requirement: The production lockdown precondition is Ken's decision
The change SHALL state the dependency on the production lockdown (sc-563) both ways and SHALL NOT choose. If Ken keeps it, deployment waits. If he waives it, `production-identities` ("LOCKDOWN comes first") SHALL also change, and threat row 18 names the session token, signing key, client secret and plaintext copy. Until he answers, deployment is not approved.

#### Scenario: Waiving the lockdown
- **GIVEN** Ken chooses to waive the lockdown
- **WHEN** the production deployment is proposed
- **THEN** it is not approved until `production-identities` no longer requires the lockdown first and threat row 18 names those four assets

#### Scenario: Ken has not answered
- **GIVEN** Ken has not decided whether the lockdown is a precondition
- **WHEN** the production deployment is proposed
- **THEN** it is not approved and the open decision is named

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
The hosted entry SHALL refuse a request whose `Host` is not on the configured public hostname list, SHALL refuse a request carrying a browser `Origin` that is not on a configured allowlist, and SHALL rate-limit the authorization, token, revocation and MCP endpoints, per endpoint and per client id. The per-endpoint limit SHALL be kept per endpoint and per source address, on every endpoint and with no shared counter, so one source cannot use up the limit for the signed-in user.

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

### Requirement: The request source is the proxy's client address
The source SHALL be the client address that the local proxy sets in `X-Forwarded-For` (the last entry is read), trusted only from a loopback peer; the table of sources SHALL stay bounded. The protection is not claimed to work until staging confirms the proxy supplies real client addresses.

#### Scenario: A forged forwarded address
- **WHEN** a caller adds its own earlier `X-Forwarded-For` entries, or sends the header from a non-loopback peer
- **THEN** the limit is still keyed by the address the proxy appended, or by the peer address, so the caller cannot choose its own key

#### Scenario: Many sources
- **WHEN** more distinct sources call than the table holds
- **THEN** the table keeps its bound by dropping the oldest source, and memory does not grow

### Requirement: A loopback peer without a usable address shares one source key
Where a loopback peer supplies no usable address the source SHALL be one shared `loopback` key, which brings back a shared limit, and the hosted entry SHALL record that (once per process, without the header value).

#### Scenario: No usable forwarded address
- **WHEN** a loopback peer calls an OAuth endpoint with a missing, empty or unparseable `X-Forwarded-For`
- **THEN** the request is keyed `loopback` and a `source-unresolved` record is written once, without the header value

### Requirement: An aggregate ceiling bounds each source prefix
On top of the per-source limit, an aggregate ceiling SHALL be kept per endpoint and per source prefix (the IPv4 /24 or IPv6 /48), counting only requests the per-source limit let through, with a default several times the per-source limit and set by configuration. It is a tier by prefix, never a global cap across all sources, so a flood from many prefixes cannot refuse the signed-in user's sign-in; the ceiling bounds one prefix, not the whole internet.

#### Scenario: A prefix flooding from many sources
- **GIVEN** the per-endpoint source limit and a lower prefix ceiling
- **WHEN** several sources in one /24 (or /48) together exceed the ceiling on an endpoint
- **THEN** the extra requests from that prefix are refused with 429, while the same endpoint still serves other prefixes

#### Scenario: A many-prefix flood spares a fresh source
- **GIVEN** a flood from many distinct prefixes, each within its ceiling
- **WHEN** a source in a prefix not yet seen signs in
- **THEN** the sign-in is not refused

#### Scenario: One noisy source does not use up its prefix
- **GIVEN** one source far over its own limit
- **WHEN** a neighbour in the same prefix calls the endpoint
- **THEN** the neighbour is served, because refused requests do not count toward the prefix

### Requirement: A valid access token skips the source and prefix counters
A `/mcp` request that carries a valid access token SHALL count only against the per-client limit and skip the source and prefix counters, because the connector arrives from shared egress ranges that other people's unauthenticated calls also use; unauthenticated `/mcp` attempts and every OAuth endpoint keep both tiers. The per-client limit is what protects the engine.

#### Scenario: A shared prefix can exhaust the OAuth tier
- **GIVEN** several sources inside the signed-in user's own prefix, or other callers on the connector's shared egress
- **WHEN** together they exhaust the tier for the OAuth endpoints
- **THEN** a `/token` refresh may be refused for a window, which costs availability, not data

#### Scenario: A signed-in call is not refused by a flood
- **GIVEN** a flood of unauthenticated `/mcp` and `/token` requests from the signed-in user's source and prefix
- **WHEN** the user's authenticated `/mcp` call arrives
- **THEN** it is not refused by the source or prefix counters

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
