# Tasks

Test-first: write each test, run it and see it fail before the code. Where a test pins behaviour that already exists, the task says so and the author records that it passed on its first run. The provider is mocked as in `packages/sync-server/src/accounts/openid.test.ts`.

Depends on sc-2684 (`openid-true-sign-out`) for group 5's switching-household checks.

## 1. Household files: no shared client ids (actual-hosting)

- [ ] 1.1 In actual-hosting `scripts/test_household.py`, add failing tests: two household files sharing a `sync_client_id` or `mcp_client_id` (in any combination) fail with both household names and the id; one file whose two ids are equal fails; the committed `production/households/*.json` pass. Also a test that loads every committed `production/households/*.json` and passes them to the check together (as `scripts/test_backup.py` does for backup files). Verify: `python3 scripts/test_household.py`, run from the actual-hosting root as Fork CI's `tooling.yml` does, fails on the new cases.
- [ ] 1.2 Implement `check_distinct_apps` in `production/household.py` (design decision 1) and call it in `main`'s `pack-secrets` branch right after the households are loaded, before any secret is written. Add a test that `pack-secrets` with two files sharing an id exits non-zero and writes nothing. Verify: 1.1 and this test pass with `python3 scripts/test_household.py`, and the actual-hosting PR names sc-2719.

## 2. Sync server: only its own app's ID tokens

- [ ] 2.1 Add failing tests to `packages/sync-server/src/accounts/openid.test.ts`: with the mocked `callback` returning claims whose `aud` is another client id (string and array forms), `loginWithOpenIdFinalize` refuses, creates no user and no session; `aud` equal to or containing the configured `client_id` is accepted; an array `aud` that contains the client id but whose `azp` is missing or another id is refused, and one whose `azp` equals the client id is accepted. Verify: `yarn workspace @actual-app/sync-server test openid` fails on the refusal cases.
- [ ] 2.2 Add the explicit audience and `azp` check in `loginWithOpenIdFinalize`, beside the existing ID-token `sub` comparison and before any user is looked up or created (design decision 2). Verify: 2.1 passes and the existing OpenID tests still pass.
- [ ] 2.3 Add tests for another household's lead on this server in both states: with no OpenID user yet and `admin_subject` set to this household's lead, the other lead is refused by `admin_subject` and nothing is created; with users already present, the other lead (not in the list) is refused by `manual` creation mode. Ken's `sub` is refused the same two ways. These pin existing behaviour (the sc-2163 backstop and `userCreationMode` defaulting to `manual`); record that they passed on first run. Verify: `yarn workspace @actual-app/sync-server test openid` passes.

## 3. MCP connector: only its own app's ID tokens

- [ ] 3.1 Add tests to `packages/mcp/src/oauth.test.ts` that the IdP callback refuses an ID token whose `aud` is another household's connector client id, and one whose `aud` is right but whose `sub` is another household's allowed account. They pin the existing checks in `oauth.ts`; record that it passed on first run. Verify: `yarn workspace @actual-app/mcp run test oauth` passes.

## 4. Plan-limit report

- [ ] 4.1 An agent drafts, from Auth0's and Tailscale's public plan pages (cite each URL and the date read), each plan's limits on applications, active users, devices and users, and the household count at which each is reached under design decision 4's assumptions, checked against 8 households. Post it as a comment on sc-2719. Verify: the comment exists with sources.
- [ ] 4.2 (Ken) Confirm the tenant's and tailnet's actual plans and limits from the Auth0 and Tailscale admin pages, and reply on the comment with any number that differs. Why Ken: the plan pages behind sign-in are visible only to the account owner; agents have no tenant or tailnet admin access. Verify: Ken's reply is on sc-2719.

## 5. Per-household applications (once per new household)

- [ ] 5.1 Write the per-household checklist for Ken (exact field values, one step at a time, a "why you" line on each; reviewed by the Checklist Reviewer), covering 5.2 to 5.5 for a named household. Verify: the Checklist Reviewer approves it.
- [ ] 5.2 (Ken) In the Auth0 tenant, create the household's sync application (Regular Web Application): Allowed Callback URLs `https://<sync_fqdn>/openid/callback`, Allowed Logout URLs `https://<sync_fqdn>/` (sc-2684). Then the MCP connector application: Allowed Callback URLs `https://<mcp_fqdn>/oauth/callback`, Allowed Logout URLs empty. Why Ken: only Ken administers the tenant.
- [ ] 5.3 (Ken) Create the lead's user in the tenant (sign-ups are off) with MFA, and the household's assistant account if it has one; send the agent the two client ids and the two `sub` values, never a secret. Why Ken: tenant admin.
- [ ] 5.4 (Ken) Add the two client secrets as `OPENID_CLIENT_SECRET__<NAME>` and `MCP_IDP_CLIENT_SECRET__<NAME>` in the GitHub `production` environment. Why Ken: the secret values come from the tenant and production secrets are his gate.
- [ ] 5.5 An agent adds `production/households/<name>.json` with the ids and subs from 5.3 in an actual-hosting PR. Verify: `household.py check` and the test from 1.1 pass.
- [ ] 5.6 After the household is deployed, verify on desktop web, Electron, the phone UI and the mobile app: the lead signs in through the household's own app and becomes ADMIN; signing out of another household's server and signing in to this one asks for a username (needs sc-2684 shipped); the lead is refused on household `ken`'s server. Verify: the Tester records the result on sc-2719.

## 6. Spec consistency before archive

- [ ] 6.1 Confirm sc-2912 has merged: the four Ken-named requirements in `openspec/changes/production-identities/specs/production-identities/spec.md` are scoped to household `ken`'s server (design, Decided). Verify: the merged PR is linked on sc-2912 and the spec text names household `ken`.

## Workflow follow-up

- Archive this change only after sc-2719 is Done and task 6.1 is checked; it must not archive before sc-2912 lands.
