# Threat model: the hosted MCP server

Scope: the hosted, read-only entry of the fork's MCP server on staging (`mcp-remote`). Production, write tools and per-client access are out of scope. This note is reviewed by the Security Analyst before any code, and is updated with each slice.

## Assets

- **Budget data** in the instance's local copy: plaintext transactions, balances, payees and notes (sensitive).
- **The Actual credential** (today the shared sync-server password, which opens every budget on that server and can change the password) and, if the budget is end-to-end encrypted, **the encryption key**. Holding the key on the server weakens end-to-end encryption.
- **The signing key and the token state file** (hashed refresh tokens and the registered client): possessing them lets an attacker act as Ken at this server.
- **The pre-registered client's secret** (Anthropic holds a copy) and **the identity provider's client id and secret**: they let an attacker impersonate the connector or this server's sign-in step.
- **Ken's upstream identity** at the identity provider.

## Actors and trust boundaries

- **Anthropic's infrastructure** calls the endpoint on Ken's behalf. Trusted to relay Ken's authorization, not to be the only control.
- **The public internet** can reach the endpoint (and only that endpoint; the Actual servers stay private).
- **Any agent session on Ken's account** sees the connector in its tool list. Agents are trusted less than Ken: they can read his mail and have root on the VPS until it is revoked (LOCKDOWN).
- **Budget text** (payees, notes, names) is untrusted input that reaches a model.
- **The VPS host** is shared by staging and production; a compromise of the container must not reach production.

## Threats and mitigations

| # | Threat | Mitigation in this change | Residual risk |
|---|---|---|---|
| 1 | An unauthenticated caller reads budget data | Every MCP request needs a valid OAuth access token bound to this resource and holding `budget:read`; 401 otherwise; no tokens in URLs | A bug in the SDK router or our provider; covered by tests and review |
| 2 | Token theft or replay | Short-lived access tokens, refresh tokens that expire (30 days at most) and are hashed and revocable, audience binding, TLS from the exposure layer | A stolen refresh token works until it expires or is revoked: rotate the key |
| 3 | A second person signs in | Exactly one configured upstream account; no emailed link or code (agents read mail) | The upstream account itself: its passkey or 2FA is an operational precondition recorded in the checklist, not enforceable in code |
| 4 | An attacker registers a malicious client | One pre-registered client; no dynamic registration by default; exact redirect-URI allowlist; PKCE | If dynamic registration is later enabled, it is limited to the allowlist |
| 5 | An authorization-code or redirect hijack | Exact redirect match, PKCE, short-lived single-use codes | None beyond protocol bugs |
| 6 | DNS rebinding or a browser-driven request | `Host` allowlist; refuse a browser `Origin` that is not allowed | Connector traffic is server to server, so this is defense in depth |
| 7 | Denial of service (the singleton engine is slow to restart) | Rate limits per endpoint and per client id on the authorization, token and MCP endpoints; paged, size-capped results; read-only so no write queue | A determined flood still ties up the one engine; the cost is availability, not data |
| 8 | The container is compromised and the credential is read | Secrets in read-only mounted 0400 files, never env values; a non-root, no-capability, read-only container with no `docker.sock` (deployment slice); read-only engine so the process cannot push | The stored credential is itself a full-access password until a per-budget identity exists (sc-1555); hence staging only |
| 9 | The signing key leaks | Rotating it invalidates every token; the key is a secret file | Until rotated, tokens it signed are valid |
| 10 | Prompt injection through budget text | The existing hygiene: structured results, text under `text`, stripped control, zero-width and bidi characters, 200-character fields, no URL fetching, paging and the response cap | Injection cannot be eliminated; the read-only, staging-only scope limits what a steered model can do |
| 11 | A steered or buggy model tries to write | No write tools exist in this entry; `--writes` is a usage error; the engine is read-only, so nothing is pushed or uploaded | None through the server; the credential is covered by 8 |
| 12 | The server is used as a request forwarder | It fetches no URL named in budget data; its only outbound calls are the sync server and the identity provider | A configuration mistake pointing it elsewhere |
| 13 | Secrets leak through logs or errors | Fixed error texts, scrubbing with the secrets list, no tool arguments or results in logs, secrets only in files | Operator-added logging |
| 14 | A new path to budget data for every agent session | The connector points at staging only; staging is already within what agents reach | Pointing it at production would break "agents can't reach production": Ken's explicit decision and a LOCKDOWN entry first |
| 15 | Stale data is trusted | Sync on start and on an interval; `get_sync_status` shows the last success and the last failure | A budget changed seconds ago may not show yet |
| 16 | A compromised container reaches production | The container runs on its own Docker network that reaches only the staging sync server: never `network_mode: host`, never a network or loopback address production's containers use (production's Actual listens on `127.0.0.1:5075` on the same host); outbound traffic limited to the staging sync server and the identity provider; checked with `docker inspect` in the deployment review | A mistake in the compose file; hence the review check |

## Residual risks accepted for staging

A public endpoint to a plaintext copy of the staging budget; the shared sync-server password stored on the server; availability depending on one process. Each is acceptable for staging data and not for production.

## Revocation, in order

1. **Turn off the exposure** (the Funnel or tunnel). This cuts every caller at once.
2. **Disconnect the connector** in Claude.
3. **Rotate the signing key, delete the token state file, and restart** (every token and refresh token dies).
4. **Stop and remove the container, and delete its data directory** (the plaintext budget copy).
5. **If a compromise is possible:** change the staging sync-server password (the stored credential), rotate the pre-registered client's secret (and tell Claude), and revoke the identity provider's client secret.

## What the deployment slice must add to LOCKDOWN

New inventory rows for: the MCP container; its exposure node identity; the signing key; the token state file; the pre-registered client and its secret; the identity provider's client id and secret; and the Actual credential it holds. The persistence check covers the container and the exposure state. Revocation follows the five steps above. The container's network isolation (threat 16) is part of the review. Deploying is a production-host change under Ken's gate (shared VPS and Docker daemon).

## To be settled by staging verification

Anthropic's source addresses and whether an edge allowlist is worth adding; each client's OAuth callback (claude.ai, the mobile apps, Claude Duet); whether a pre-registered client is accepted by the connector beta. Until then none of them is assumed.
