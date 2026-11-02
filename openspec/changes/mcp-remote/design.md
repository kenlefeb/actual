# Design

## Context

See proposal.md (Why) and `threat-model.md`. The findings and the options weighed are on sc-1950 (Security Analyst comment 1955, Architect comment 1956, PO decision 1957). This change is slice 1: the spec and the threat model, with no code. The later slices (the hosted entry, the OAuth provider, the deployment, the connection checklist) are filed when this merges.

Facts the design rests on:
- `createServer()` in `packages/mcp` is transport-agnostic; the stdio entry only connects a `StdioServerTransport`. A hosted entry calls the same function and never registers the write tools.
- The pinned `@modelcontextprotocol/sdk` (exact 1.32.1) ships `StreamableHTTPServerTransport` (with a stateless option), `createMcpExpressApp` with host-header DNS-rebinding protection, `mcpAuthRouter` with an `OAuthServerProvider` interface, `mcpAuthMetadataRouter`, `requireBearerAuth` (verifier, required scopes, expected resource) and `ProxyOAuthServerProvider`. No new dependency should be needed.
- `@actual-app/api` is a process-wide singleton: one `init` and one loaded budget per process.
- Anthropic's connectors call the server from Anthropic's infrastructure, so a tailnet-only address cannot serve them.

## Decisions

### 1. A separate entry, not a mode of the stdio entry
The hosted server is its own entry (for example `actual-mcp-http`). That keeps the stdio entry's "no listener" statement literally true, keeps the hosted entry's read-only guarantee in its own code path (it cannot be switched off by a flag it does not have), and lets the two evolve separately. Both call `createServer`, so tools, sanitizing, paging and the response cap are identical.

### 2. Stateless streamable HTTP
A fresh transport per request, no session state on the server. Read-only tools need none, and there is nothing to leak or lose. SSE is not offered (Claude documents it as deprecating).

### 3. One budget per instance, with a freshness schedule
The singleton engine means one instance serves one budget of one environment; a second budget is a second instance with its own hostname or path, credentials and data directory (`<env>-remote`). Because the process lives for days, it syncs at start and on an interval, serialized with `sync_budget` by a lock, and keeps serving the last copy when a sync fails; `get_sync_status` makes staleness visible instead of silent.

### 4. Read-only in code
`init({ readOnly: true })` is passed unconditionally (see `api-read-only-mode`), the write tools are never imported by this entry, and `--writes` is a usage error. The effect: even a compromised authorization layer cannot make the engine push or upload anything. The one remaining write path from that host is the stored sync-server password, which is why production waits for a per-budget identity (sc-1555).

### 5. Authentication: our own authorization server, one upstream identity
The server runs the SDK's authorization router with its own `OAuthServerProvider`. Its `authorize` step hands the user to a configured upstream identity provider and accepts exactly one configured account identifier; it never accepts an emailed link or code, because agents can read Ken's mail. Access tokens are opaque, short-lived and bound to the server's resource URL; refresh tokens expire after at most 30 days, are stored hashed in a 0600 state file on the instance's volume and can be revoked; rotating the signing key invalidates everything. As built (sc-1972): access tokens are HMAC-signed, last 15 minutes and carry their refresh family, so revoking the family stops them at once; refresh tokens rotate on every use, a replayed old token ends its family, and a family ends 30 days after the sign-in whatever its use; the refresh hashes are keyed with the signing key, so rotating it also strands the state file; the upstream ID token is taken straight from the provider's token endpoint over TLS, so its signature is not re-verified. The provider is configuration (issuer, client id and secret file, the account identifier), so the choice of GitHub, Google or another provider is not baked in. Rejected: an external authorization server (more internet-facing code to patch for one user), a static bearer token or secret URL (a connector cannot set one, it leaks into logs and cannot be revoked per client), and an access proxy such as Cloudflare Access (connectors cannot present its service-token headers).

### 6. Registered clients, not open registration
One pre-registered confidential client, using the custom client id and secret that Anthropic documents for servers without dynamic client registration, so no open registration endpoint faces the internet. Redirect URIs are matched exactly against a configured allowlist whose default is the documented Claude callback (`https://claude.ai/api/mcp/auth_callback`, which Anthropic says may move to a `claude.com` URL). Dynamic registration exists only behind a configuration switch, off by default, and then only for the allowlist. Always PKCE; scope `budget:read`, with the scope plumbing in place for a later `budget:write` that this change does not register.

### 7. Host, origin and rate checks
The listener binds to the configured address (loopback by default). A `Host` allowlist (the SDK's host-header validation, with the public hostname as configuration) blocks DNS rebinding. Connector traffic is server to server, so a request carrying a browser `Origin` that is not on an allowlist is refused (the SDK's check does not cover `Origin`). The authorization, token, revocation and MCP endpoints are rate-limited per endpoint and per client id, and per source address as well, with no shared counter for an endpoint, so an unauthenticated flood cannot lock the one identity out. The source is the last `X-Forwarded-For` entry, which the local Funnel proxy appends, and is read only when the socket peer is loopback (an IPv6 source is keyed by its /64). The table of sources is capped; when full the oldest is dropped, which only restarts its count.

### 8. Secrets in read-only files
Three secrets: the Actual credential, the optional encryption key and the signing key. Each is read from a file whose path is configuration, and the server refuses to start when a file is missing or readable by anyone but its owner. They never appear on a command line, in an environment value, a URL, a log, an error or a tool result. The state file holds nothing that outlives rotating the signing key.

### 9. Recording access without data
Authentication events and the name and status of each tool call are logged with the client id and time, scrubbed with the secrets list, to the container's log stream. Tool arguments and results are not logged, because they can contain budget data; this is the hosted counterpart of the write audit log, which does not apply to a read-only entry.

### 10. Exposure and deployment are configuration, decided later
Only the MCP service is public; the Actual servers stay private. **Network isolation:** the container runs on its own Docker network that reaches only the staging sync server, never with `network_mode: host` and never on a network or loopback address that production's containers use (production's Actual listens on `127.0.0.1` on the same host), and its outbound traffic is limited to that sync server and the identity provider. The deployment review checks this with `docker inspect` (network mode, networks, published ports and mounts). The exposure mechanism (a Tailscale Funnel on its own node, or a tunnel with its own edge), the hostname, the identity provider and the plaintext staging copy are Ken's decisions, needed before the OAuth slice and the deployment slice. The deployment (a compose file in actual-hosting, a container built from this repository, a separate sidecar, the secrets, the LOCKDOWN rows) is a later slice and a production-host change under Ken's gate, because staging and production share one VPS and Docker daemon.

## Unverified, settled by staging verification (not assumed here)
- Which source addresses Anthropic's connector calls use, and so whether an edge allowlist is worth adding (it is not available behind plain Funnel).
- The callback URL used by each client: claude.ai, the mobile apps and Claude Duet. Duet's connector mechanism is undocumented as far as the Explore found, so the design stays on standard OAuth 2.1 (protected-resource and authorization-server metadata, PKCE, resource indicators) with a configurable redirect allowlist.
- Whether the current connector beta accepts our authorization server with a pre-registered client.

The requirement "Clients are supported only after they connect on staging" turns these into checklist items.

## Risks / Trade-offs

- **A public endpoint for budget data.** Mitigated by one identity, short tokens, read-only in code, staging only, and no production until a per-budget identity exists.
- **Plaintext budget copy and the sync password on the server.** Acceptable for staging only; the encryption key on the server weakens end-to-end encryption, so production needs a decision of its own.
- **Every agent session gets a path to the budget.** Connectors on Ken's account also appear in Claude Code sessions. Pointing the connector at staging is within what agents already reach; pointing it at production would not be, and needs Ken's explicit decision and a LOCKDOWN entry.
- **Maintaining OAuth code.** Kept small by using the SDK's router and one provider for one user; a dependency on an external service is avoided on purpose.

## Decisions for Ken

None in this change. Ken's answers (identity provider, hostname and Funnel permission, the plaintext staging copy) are asked one at a time through the Director before the slices that need them.
