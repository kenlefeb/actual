# Proposal

## Why

Shortcut sc-2719. ADR 0009 (sc-2715) runs several households on one host, each with its own sync server and hosted MCP connector, and one Auth0 tenant serves them all. Each household needs its own pair of Auth0 applications (one for its sync server, one for its MCP connector) so a sign-in made for one household's server cannot be used on another's, and each household's lead administers only that household's server (Ken's decision, 2026-11-06; Ken runs the tenant but not the households' servers or budgets).

Because one tenant means one provider session per browser, switching households also needs sign-out to end the provider session. That is sc-2684, specified in the change `openid-true-sign-out`; this change depends on it and does not restate it.

## What Changes

- Every household has its own sync app and MCP connector app in the shared tenant; no client id is shared between households or between a household's two apps. The household template (actual-hosting `production/households/<name>.json`, `auth0.sync_client_id` and `auth0.mcp_client_id`; secrets per household since sc-2828) already carries them; its check gains a rule that refuses a shared id.
- A household's sync server accepts an OpenID sign-in only when the ID token was issued to its own sync app. The hosted MCP connector already checks its own app (`packages/mcp/src/oauth.ts`); a test pins it.
- The household lead's Auth0 `sub` is that household's `auth0.admin_subject`, so the first sign-in, and ADMIN, is the lead's (the sc-2163 backstop, per household). The lead has no user on any other household's server.
- Switching households asks who is signing in: the sc-2684 sign-out requirement applied across households.
- A plan-limit report: Auth0 applications and active users, Tailscale devices and users, against 8 households (the ADR's KVM 2 ceiling). An agent drafts it from public plan docs; Ken confirms it from his admin pages. Report only; changing a plan is Ken's decision.
- Ken creates each household's two apps and the lead's user through a checklist; no agent has tenant access.

Out of scope: custom domains, billing, changing any Auth0 or Tailscale plan, restricting users per application inside Auth0 (the server's own user list does that), and provisioning automation (sc-2721).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `production-identities`: adds the per-household app pair and per-household admin requirements. The capability is introduced by the active change `production-identities` and also extended by `openid-true-sign-out`; this change adds to the same capability for the same reasons given in `openid-true-sign-out`'s proposal (independent archive, one change per story, no second capability). The sign-out requirements are referenced, not copied.

## Mobile scope

No new screens. Sign-in and sign-out run through the same server on desktop web, Electron, the phone UI (the budget list's user menu) and the mobile app; the scenarios name each, and the sign-out half is tested under `openid-true-sign-out`.

## Impact

- `packages/sync-server/src/accounts/openid.ts` (ID token audience check) and its tests.
- `packages/mcp/src/oauth.test.ts` (a pinning test, no code change expected).
- actual-hosting: `production/household.py` and `scripts/test_household.py` (distinct client ids across household files), and one `production/households/<name>.json` per new household.
- Auth0 tenant and GitHub `production` environment secrets: Ken's steps per household.
- Depends on sc-2684 (`openid-true-sign-out`) for the switching-household scenarios.
