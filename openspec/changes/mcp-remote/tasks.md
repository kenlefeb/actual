# Tasks

## 1. Spec and threat model (sc-1950)

- [x] 1.1 Spec `mcp-remote` and the scoped wording of `mcp-server` "Local stdio only". Verify with `openspec validate mcp-remote --strict`.
- [x] 1.2 Write `threat-model.md` and the design, identity-provider-neutral, with the unverified items recorded as things staging verification settles.
- [x] 1.3 Security Analyst approves before any code, and the PO approves (both approved #185).
- [x] 1.4 File the slice stories under epic 1550 (the hosted entry and freshness; the OAuth provider and token store; the container, exposure, secrets runbook and LOCKDOWN rows, Ken's gate; the connection checklist), add each to `x-shortcut` and give each of groups 2 to 5 below its story id, and add the `spec:mcp-remote` label.

## 2. Hosted entry and sync freshness (sc-1971)

- [x] 2.1 Add the separate hosted entry over stateless streamable HTTP, with the read-only init fixed in code, the staging-only check, `--writes` refused, the `<env>-remote` data directory, host and origin checks and rate limits, with tests named after the "A separate hosted entry", "Hosted means read-only, in code", "Staging only in v1", "One budget per instance" and "Host, origin and rate checks" scenarios.
- [x] 2.2 Add the sync schedule, its lock with `sync_budget`, last-good serving and `get_sync_status`, with tests named after "The copy stays fresh".
- [x] 2.3 Add access recording and secret-file handling, with tests named after "Access is recorded without data" and "Secrets live in read-only files".

## 3. OAuth provider and token store (sc-1972)

Ken chose Auth0 as the identity provider on 2026-11-02, superseding the Google choice (sc-1972 comment 2022), with a separate tenant per environment; the provider stays configuration.

- [x] 3.1 Add the authorization server on the SDK router: the one identity through the configured provider, the pre-registered client, the redirect allowlist, PKCE, audience-bound short-lived tokens, hashed revocable refresh tokens and the signing key, with tests named after "Authenticated with OAuth", "Short-lived, revocable tokens", "Exactly one identity" and "Clients are registered, not open".

## 4. Container, exposure and deployment, Ken's gate (sc-1973)

Needs Ken's answers on Funnel, the hostname and the plaintext staging copy.

- [ ] 4.1 Add the image build and a compose file in actual-hosting with its own exposure node, a dedicated Docker network that reaches only the staging sync server (never `network_mode: host`, never production's network or loopback address) with outbound traffic limited to that server and the identity provider, the secrets runbook, and the LOCKDOWN inventory rows (container, exposure node, signing key, token state file, pre-registered client secret, identity-provider client credentials, the Actual credential) with the five-step revocation order; the review checks the isolation with `docker inspect`; then the staging deployment, reviewed by the Security Analyst and approved by Ken.

## 5. Connection checklist (sc-1974)

- [ ] 5.1 Write the checklist for Ken (claude.ai, the phone, Claude Duet), reviewed by the Checklist Reviewer, that records each client's callback, the connector's source addresses and whether the pre-registered client is accepted, and that does not claim support for a client that has not connected ("Clients are supported only after they connect on staging").
- [ ] 5.2 Archive this change when its last story merges, add `mcp-remote` to the #1550 row in the epic table of `docs/agents/issue-tracker.md`, and file Backlog stories for any open follow-up (production after sc-1555; any write tool; an edge allowlist if verification shows it is worth it).

## 6. Per-source rate limit (sc-2090)

- [x] 6.1 Key the endpoint rate limit per source address (the last `X-Forwarded-For` entry, trusted only from a loopback peer) with a bounded table, with tests named after the "A flood from one source spares another", "A forged forwarded address" and "Many sources" scenarios.
- [ ] 6.2 (now story sc-2278) On staging, confirm through the Funnel that the access log shows real client addresses and no `source-unresolved` record: one flooded source and one clean sign-in from a second network; and record which addresses Ken's connector actually arrives from (Anthropic's shared egress ranges), since other customers' connectors share them. Do not claim the per-source protection until this is recorded (the connection checklist, 5.1, records the same).

## 7. Production slice: spec and design (sc-2215)

- [ ] 7.1 Replace "Staging only in v1" with the production guard; specify the production identity, network and exposure, the go-live prerequisites and the lockdown dependency; update the design and threat model. Verify with `openspec validate mcp-remote --strict`.
- [ ] 7.2 Security Analyst approves the spec and design before code; the PO approves intent. **Open decision for Ken:** whether the production lockdown (sc-563) is a precondition (design Decision 15); record the answer here and in the threat model (row 18).

## 8. Lift the code refusal (sc-2277)

- [x] 8.1 Write failing tests (run them failing first), then change `loadRemoteConfig` so a production host is served only under the guard (flag, session-token file, subject-identifier account, `production-remote` directory), read-only unchanged, with tests named after the "Production only under an explicit guard" scenarios. Also: refuse a `local`-labelled server together with a non-loopback listener; and in production validate the session token against the sync server at start and exit if its user is ADMIN, with tests named after "A production token is never an administrator's". First confirm in a test against the real sync server that its validate endpoint returns the user's permission; if it does not, the entry instead reads the permission from the sync server's user listing for that token, and if neither is available it exits (fail closed) and the Architect decides the alternative before code continues.

## 9. Production container, exposure and deployment, Ken's gate (sc-2218)

Blocked on sc-2277, the go-live prerequisites (design Decision 14: sc-2278 for task 6.2, sc-2265, sc-2203, sc-2069) and Ken's answer on the lockdown.

- [ ] 9.1 Add the production compose file, runbook and LOCKDOWN rows (container, node, signing key, state file, client secret, tenant client secret, session token, egress rule) with the production revocation order; the egress control follows design Decision 14 (the sidecar by named destinations, the MCP process by a hostname allow-list, the node's own tailnet tag); the review checks the "Production network and exposure" and "Production prerequisites before go-live" scenarios with `docker inspect` and from-inside connection tests; the data-directory name is paired with a `docker inspect` mount check; the checklist states whether VPS snapshots include the data directory, records the image's source commit, tag and digest, and a revocation drill is rehearsed once on staging first. Security Analyst approves and Ken approves before anything is deployed.

## 10. Production connection checklist (sc-2219)

- [ ] 10.1 Write the checklist for Ken, reviewed by the Checklist Reviewer: confirm sc-2069, connect the assistant with the pre-registered client on a client already proven on staging, prove real client addresses in the access log, and record the revocation steps.

## 11. Aggregate ceiling (sc-2265)

- [x] 11.1 (sc-2265) Add the per-prefix aggregate ceiling (IPv4 /24, IPv6 /48; `ACTUAL_MCP_RATE_PER_PREFIX`, default 600) with tests named after "A prefix flooding from many sources", "A many-prefix flood spares a fresh source" and "One noisy source does not use up its prefix".
