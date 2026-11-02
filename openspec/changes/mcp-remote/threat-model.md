# Threat model: the hosted MCP server

Scope: the hosted, read-only entry of the fork's MCP server (`mcp-remote`) on staging and, from the production slice (sc-2215), on production. Write tools and per-client access are out of scope. This note is reviewed by the Security Analyst before any code, and is updated with each slice.

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
| 7 | Denial of service (the singleton engine is slow to restart) | Rate limits per source address and endpoint (so a flood from another source cannot lock the real user out), and per client id, on the authorization, token and MCP endpoints; paged, size-capped results; read-only so no write queue | A determined flood still ties up the one engine; the cost is availability, not data. The per-source limit does not stop a caller who shares Ken's address (carrier NAT, the same IPv6 /64), nor many sources (a botnet, or one /48 holding 65k /64 keys); there is no aggregate cap across sources. Cycling more than 10,000 sources through the table drops the oldest-inserted key, which resets any counter, an attacker's included. If the proxy supplies no address, every caller shares one `loopback` key (logged once as `source-unresolved`) until staging confirms real addresses (task 6.2) |
| 8 | The container is compromised and the credential is read | Secrets in read-only mounted 0400 files, never env values; a non-root, no-capability, read-only container with no `docker.sock` (deployment slice); read-only engine so the process cannot push | The stored credential is itself a full-access password until a per-budget identity exists (sc-1555); hence staging only |
| 9 | The signing key leaks | Rotating it invalidates every token; the key is a secret file | Until rotated, tokens it signed are valid |
| 10 | Prompt injection through budget text | The existing hygiene: structured results, text under `text`, stripped control, zero-width and bidi characters, 200-character fields, no URL fetching, paging and the response cap | Injection cannot be eliminated; the read-only, staging-only scope limits what a steered model can do |
| 11 | A steered or buggy model tries to write | No write tools exist in this entry; `--writes` is a usage error; the engine is read-only, so nothing is pushed or uploaded | None through the server; the credential is covered by 8 |
| 12 | The server is used as a request forwarder | It fetches no URL named in budget data; its only outbound calls are the sync server and the identity provider | A configuration mistake pointing it elsewhere |
| 13 | Secrets leak through logs or errors | Fixed error texts, scrubbing with the secrets list, no tool arguments or results in logs, secrets only in files | Operator-added logging |
| 14 | A new path to budget data for every agent session | Staging: the connector is within what agents already reach. Production: the account split (sc-2069) first, so a fresh agent session lists no production tool; the allowed account is the assistant's, whose credentials no agent holds | Production breaks "agents can't reach production" for whoever holds Ken's assistant sign-in; Ken's explicit decision and a LOCKDOWN entry, see 18 |
| 15 | Stale data is trusted | Sync on start and on an interval; `get_sync_status` shows the last success and the last failure | A budget changed seconds ago may not show yet |
| 16 | A compromised container reaches production | The container runs on its own Docker network that reaches only the staging sync server: never `network_mode: host`, never a network or loopback address production's containers use (production's Actual listens on `127.0.0.1:5075` on the same host); outbound traffic limited to the staging sync server and the identity provider; checked with `docker inspect` in the deployment review | A mistake in the compose file; hence the review check |
| 17 | Production is served by mistake, or by the stdio override | The production guard: a dedicated flag, a session token (never the password), a subject identifier as the account, the `production-remote` directory; the stdio `ACTUAL_MCP_ALLOW_PRODUCTION` does not count | An operator who sets the flag on purpose; the deployment review checks the configuration |
| 18 | An agent with VPS root reads the production secret files or plaintext copy | Files owned by the container's uid and 0400/0600; a data directory readable only by that uid; the lockdown (sc-563) removes agent root | **Depends on Ken's open decision:** if the lockdown is a precondition this is removed before go-live; if waived, `production-identities` must also be changed (its lockdown-first rule), and agents with root can read the session token, the signing key, the client secret and the plaintext copy, which Ken accepts |
| 19 | A compromised production container exfiltrates the copy or reaches the host or tailnet | Mandatory egress control (sc-2203): the sidecar's Tailscale traffic by named destinations, the MCP process limited to the sync server and the tenant by a hostname allow-list (no IP rules for the CDN-fronted tenant); the node's own tailnet tag may reach only the production sync server, no inbound but Funnel; dedicated network, no host network, no `docker.sock`, loopback of production never used | A mistake in the rule; hence the `docker inspect` and from-inside connection checks |
| 20 | The staging instance or tenant is used to reach production, or the reverse | Separate tenant, client, account, node, hostname, network and data directory; the review fails if any value is shared | Shared VPS and Docker daemon (accepted, as for staging) |
| 21 | The production sign-in is phished or the administrator is used | The allowed account is the BASIC-role assistant, not the ADMIN; passkey or authenticator app required; sign-ups and social logins off; no agent holds its credentials | The assistant's own device and passkey |
| 22 | A flood spread over many sources guesses the client secret | Per-source limit proven on staging (6.2) and a coarse aggregate ceiling (sc-2265) before go-live | Secret size and PKCE make guessing impractical either way |
| 23 | An ADMIN token is placed in the token file | The entry validates the token against the sync server at start and exits if its user is ADMIN or it cannot be validated | The check trusts the sync server's answer |
| 24 | A `local`-labelled server bypasses the production checks | The entry refuses a loopback server with a non-loopback listener | A loopback forward with a loopback listener is not public |

## Residual risks accepted for staging

Also accepted from the OAuth slice: the SDK compares the pre-registered client secret with `!==` (not constant time), which the per-endpoint rate limit and a 256-bit-class secret make impractical to exploit; and the upstream ID token's signature is not re-verified because it arrives directly from the provider's token endpoint over TLS (OIDC Core 3.1.3.7). A sign-in started by an attacker cannot deliver a code anywhere but the allowlisted redirect URI, where the client's own `state` check rejects it.

A public endpoint to a plaintext copy of the staging budget; the shared sync-server password stored on the server; availability depending on one process. Each is acceptable for staging data. For production the shared password is replaced by the assistant's session token, and the plaintext copy stays in the container's data directory only, removed with it; availability on one process stays accepted. What remains for production is threat 18, Ken's decision.

## Revocation, in order

1. **Turn off the exposure** (the Funnel or tunnel). This cuts every caller at once.
2. **Disconnect the connector** in Claude.
3. **Rotate the signing key, delete the token state file, and restart** (every token and refresh token dies).
4. **Stop and remove the container, and delete its data directory** (the plaintext budget copy).
5. **If a compromise is possible:** change the staging sync-server password (the stored credential), rotate the pre-registered client's secret (and tell Claude), and revoke the identity provider's client secret.

## Production revocation

The five steps above apply to the production instance unchanged and in the same order, plus: revoke the assistant's session token on the production sync server (changing the role or removing the user in the tenant also cuts it), and remove the assistant user at the production tenant or disable its passkey. Disconnect the connector in Claude first when only the connector is to stop.

## What the deployment slice must add to LOCKDOWN

New inventory rows for: the MCP container; its exposure node identity; the signing key; the token state file; the pre-registered client and its secret; the identity provider's client id and secret; and the Actual credential it holds. The persistence check covers the container and the exposure state. Revocation follows the five steps above. The container's network isolation (threats 16 and 19) is part of the review. For production the rows are repeated for the production container, node, signing key, state file, client secret, tenant client secret and session token, plus the egress rule. Deploying is a production-host change under Ken's gate (shared VPS and Docker daemon).

## To be settled by staging verification

Anthropic's source addresses and whether an edge allowlist is worth adding; each client's OAuth callback (claude.ai, the mobile apps, Claude Duet); whether a pre-registered client is accepted by the connector beta. Until then none of them is assumed.
