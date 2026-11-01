# Tasks

## 1. Spec and threat model (sc-1950)

- [x] 1.1 Spec `mcp-remote` and the scoped wording of `mcp-server` "Local stdio only". Verify with `openspec validate mcp-remote --strict`.
- [x] 1.2 Write `threat-model.md` and the design, identity-provider-neutral, with the unverified items recorded as things staging verification settles.
- [x] 1.3 Security Analyst approves before any code, and the PO approves (both approved #185).
- [x] 1.4 File the slice stories under epic 1550 (the hosted entry and freshness; the OAuth provider and token store; the container, exposure, secrets runbook and LOCKDOWN rows, Ken's gate; the connection checklist), add each to `x-shortcut` and give each of groups 2 to 5 below its story id, and add the `spec:mcp-remote` label.

## 2. Hosted entry and sync freshness (sc-1971)

- [ ] 2.1 Add the separate hosted entry over stateless streamable HTTP, with the read-only init fixed in code, the staging-only check, `--writes` refused, the `<env>-remote` data directory, host and origin checks and rate limits, with tests named after the "A separate hosted entry", "Hosted means read-only, in code", "Staging only in v1", "One budget per instance" and "Host, origin and rate checks" scenarios.
- [ ] 2.2 Add the sync schedule, its lock with `sync_budget`, last-good serving and `get_sync_status`, with tests named after "The copy stays fresh".
- [ ] 2.3 Add access recording and secret-file handling, with tests named after "Access is recorded without data" and "Secrets live in read-only files".

## 3. OAuth provider and token store (sc-1972)

Needs Ken's choice of identity provider first.

- [ ] 3.1 Add the authorization server on the SDK router: the one identity through the configured provider, the pre-registered client, the redirect allowlist, PKCE, audience-bound short-lived tokens, hashed revocable refresh tokens and the signing key, with tests named after "Authenticated with OAuth", "Short-lived, revocable tokens", "Exactly one identity" and "Clients are registered, not open".

## 4. Container, exposure and deployment, Ken's gate (sc-1973)

Needs Ken's answers on Funnel, the hostname and the plaintext staging copy.

- [ ] 4.1 Add the image build and a compose file in actual-hosting with its own exposure node, a dedicated Docker network that reaches only the staging sync server (never `network_mode: host`, never production's network or loopback address) with outbound traffic limited to that server and the identity provider, the secrets runbook, and the LOCKDOWN inventory rows (container, exposure node, signing key, token state file, pre-registered client secret, identity-provider client credentials, the Actual credential) with the five-step revocation order; the review checks the isolation with `docker inspect`; then the staging deployment, reviewed by the Security Analyst and approved by Ken.

## 5. Connection checklist (sc-1974)

- [ ] 5.1 Write the checklist for Ken (claude.ai, the phone, Claude Duet), reviewed by the Checklist Reviewer, that records each client's callback, the connector's source addresses and whether the pre-registered client is accepted, and that does not claim support for a client that has not connected ("Clients are supported only after they connect on staging").
- [ ] 5.2 Archive this change when its last story merges, add `mcp-remote` to the #1550 row in the epic table of `docs/agents/issue-tracker.md`, and file Backlog stories for any open follow-up (production after sc-1555; any write tool; an edge allowlist if verification shows it is worth it).
