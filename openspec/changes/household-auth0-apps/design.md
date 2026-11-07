# Design

## Context

See proposal.md for why. What exists:

- actual-hosting `production/household.py` validates one household file at a time (`check`) and renders `production/template/`. `auth0.sync_client_id` feeds `ACTUAL_OPENID_CLIENT_ID` in the sync compose; `auth0.mcp_client_id` feeds `ACTUAL_MCP_IDP_CLIENT_ID`; `auth0.admin_subject` feeds `ACTUAL_OPENID_ADMIN_SUBJECT` (the sc-2163 backstop); `auth0.mcp_allowed_account` feeds `ACTUAL_MCP_ALLOWED_ACCOUNT`. Secrets are per household (`OPENID_CLIENT_SECRET__<NAME>`, `MCP_IDP_CLIENT_SECRET__<NAME>`, sc-2828). `check_distinct_backups` already compares households for backups; nothing compares client ids.
- Sync server (`accounts/openid.ts`): `setupOpenIdClient` builds an openid-client `Client` with `client_id` and `validate_id_token: true`, so openid-client checks `aud` inside `client.callback`. The unit tests mock `callback`, so nothing in this repo pins that check. `loginWithOpenIdFinalize` already compares the ID token `sub` with userinfo `sub` (sc-2163). Unlisted users are refused because `ACTUAL_USER_CREATION_MODE` defaults to `manual` and the template does not set it.
- MCP connector (`packages/mcp/src/oauth.ts`): the IdP callback requires `aud` to include `config.idp.clientId` and `sub` to match the allowed account.
- Sign-out: change `openid-true-sign-out` returns to `new URL('/', server_hostname)`, so each household's return URL follows from its `sync_fqdn` with no new setting.

## Goals / Non-Goals

**Goals:** a household cannot use another's apps, by configuration check and by server check; each household's first admin is its lead; Ken gets a precise per-household checklist and a plan-limit report.

**Non-Goals:** per-application user restriction in Auth0 (Actions or connections per household); automating app creation through the Auth0 Management API (agents have no tenant access by design); provisioning workflow (sc-2721).

## Decisions

### 1. Distinct client ids are checked across all household files

Add `check_distinct_apps(households)` next to `check_distinct_backups`, run wherever the household files are loaded together (`pack-secrets`, the deploy job's household loop, `scripts/test_household.py` over `production/households/*.json`). It fails when an id repeats across households or when a household's two ids are equal. Alternative: rely on review. Rejected: a copied household file is the likeliest mistake, and it would silently let two households share sessions.

### 2. Pin the audience check in the sync server

Add an explicit check in `loginWithOpenIdFinalize` that the ID token's `aud` includes the configured `client_id`, next to the existing `sub` comparison. openid-client already does this inside `callback`; the explicit check makes the requirement testable with the mocked provider and survives a future switch of library or `validate_id_token`. Alternative: test openid-client with a signed token and a stub token endpoint; heavier and tests the library, not our configuration.

### 3. The lead is the backstop subject; Ken is not on household servers

`admin_subject` is the lead's `sub`. Ken creates the lead's tenant user (sign-ups are off) but does not sign in to the household's server. The requirements in the `production-identities` change that name Ken as the only ADMIN ("Production signs in only through OpenID") describe household `ken`'s server; see Decisions for Ken.

### 4. Plan limits are a report, not a gate

An agent drafts the limits from public plan pages and states the household count at which each is reached, assuming two applications, the lead plus up to one more member, and the assistant account per household, and one shared Tailscale node per household server and per MCP connector. Ken confirms the plan and numbers from his admin pages. Nothing in the build waits on it unless a limit is under 8.

## Risks / Trade-offs

- [One tenant session spans households until sc-2684 ships] → Build of the switching scenario waits on sc-2684; until then a second household is not provisioned (sc-2721 is blocked by this story).
- [Any tenant user can authenticate to any household's app] → The server's user list refuses them (Decision 3); the provider still sees the attempt. Per-app restriction in Auth0 is a possible follow-up.
- [A plan limit below 8 households] → Reported to Ken; upgrading is his decision and a separate story.
- [Ken mistypes a client id or URL in a checklist] → The household check catches reused ids; the staging-style verification step catches a wrong callback or logout URL.

## Decisions for Ken

- Wording of the `production-identities` change: "Ken SHALL be its only ADMIN" and "No other person ... SHALL have a production user" read as household `ken`'s server. Recommendation: when that change is next edited or archived, scope those requirements to household `ken`, and let this change's per-household admin requirement govern other households. Not blocking this change.

## Migration Plan

Household `ken` already has its own pair (`ken.json`), so the new check passes today. Each new household is added by its checklist, then a deploy. Rollback of the sync-server audience check is the previous release; it refuses nothing that a correct configuration accepts.
