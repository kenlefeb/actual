# Design

## Context

See proposal.md for the motivation and specs/mcp-server/spec.md for the requirements.

Current state (`packages/mcp/src`):

- `server.ts`: one `register` wrapper wraps every tool. It turns errors into fixed text and lets a `Refusal`'s message through. It registers the `write_` tools only when an audit log path is passed.
- `tools/write/shared.ts`: every write goes through `loggedWrite`, which takes `entry: { ids, changes }` (the before and after values, computed before the write), appends the attempt line, then writes.
- `oauth.ts`: the hosted entry is its own OAuth 2.1 authorization server. Auth0 is only the upstream sign-in and returns an ID token; Auth0 holds no API scopes for us. The entry issues one scope, `budget:read`. `authenticate` checks that scope once per request, and no tool checks a scope (`mcp-remote-read-write`, design D2). Refresh can't widen scopes (`exchangeRefreshToken` refuses scopes the family lacks).
- `remote.ts`: builds a fresh `McpServer` per request (stateless), with the caller's `subject` and client id known.
- Production compose (`actual-hosting`, `production/template/mcp/compose.yaml`): a read-only root filesystem. `/data` is a writable volume owned by the server's uid (10021). Secrets are a read-only bind mount at `/run/mcp-secrets`.

## Goals / Non-Goals

**Goals:**

- One enforcement point, in the registration wrapper, so a new tool only declares its scopes.
- Grants Ken can change without a deploy or a reconnect, which fail closed and which the server process can't widen.
- Today's behaviour preserved for both stdio entries and, once its grant is installed, for production.

**Non-Goals:**

- The parity tools themselves (sc-4203's children, sc-1556, sc-4478).
- Undo (sc-4215). It will be a write that needs the original tool's scopes.
- A UI for editing grants.
- Per-budget grants inside one instance: each instance serves one budget (`mcp-remote`, "One budget per instance"), so an instance's grants file is already per budget and per environment.

## Decisions

### D1. Six scopes by area, with `delete` combined

The six scopes are `budget:read`, `transactions:write`, `budget:write`, `structure:write`, `schedules:write` and `delete`. A deleting, closing or merging tool needs `[<area>:write, delete]`.

**Why:** Ken thinks in areas ("may fix transactions, may not delete"). Per-tool scopes would grow with every parity story into a list nobody reads. Making `delete` its own scope, combined with the area, turns "never delete" into one switch.

**Alternatives:**
- Per-tool scopes: too fine.
- One `write` scope: too coarse, because it is today's problem again.
- A `<area>:delete` scope per area: doubles the list for little gain.

### D2. The token scope stays `budget:read`; the grant is the permission

The hosted entry keeps issuing tokens with `budget:read` only, as an admission scope that means "may use this endpoint". Every call looks up the grant for (subject, client id). Tokens do not carry write scopes.

**Why:**
- Refresh can't widen a token's scopes, so token-borne write scopes would force Ken to reconnect claude.ai on every grant change. The existing production connection would also drop to read-only until he reconnected.
- What scope a client requests is client behaviour. The bundled SDK client (1.32.1, SEP-835) asks for the `scope` in `WWW-Authenticate`, then the resource metadata's `scopes_supported`. Claude.ai's own behaviour isn't documented or observed in this repo, so the design must not depend on it.
- A server-side grant revokes on the next call, not after the 15-minute token lifetime.

**Alternative considered:** advertise all six scopes and use (token scopes ∩ grant), as proposed in the sc-4477 Explore comment. That would let a client ask for less than its grant. It is rejected for now because of the reconnect and revocation problems above. A read-only connection is still possible: grant its client id `budget:read` only.

### D3. Grants file: per instance, read-only to the server, checked every call

`ACTUAL_MCP_GRANTS_FILE` names a JSON file:

```json
{
  "version": 1,
  "grants": [
    { "subject": "auth0|…", "client": "*", "scopes": ["budget:read"] },
    { "subject": "auth0|…", "client": "<pre-registered client id>", "scopes": ["budget:read", "transactions:write", "budget:write", "structure:write", "schedules:write"], "confirm_destructive": true, "max_rows": 10 }
  ]
}
```

**Schema (strict).** Any violation makes the whole file invalid:
- `version` is 1, and there are no unknown keys at any level.
- `subject` is a literal subject, never a wildcard. `client` is a literal client id or `*`.
- `scopes` is a non-empty array of known scope names. `max_rows` is a positive integer; values above 50 are capped at 50. `confirm_destructive` is a boolean.
- No (subject, client) pair appears twice. That rules out first-wins versus last-wins ambiguity: a later edit can't silently widen access.
- A `*` grant holds `budget:read` only.
  - Why: dynamically registered clients get a fresh server-minted id each time and live in memory only. A `*` entry with write scopes would cover every present and future client.
  - So writes go only to named client ids. The pre-registered client (`ACTUAL_MCP_CLIENT_ID`, which claude.ai uses) is the one stable id.

**Defaults:** on a hosted grant, an absent `confirm_destructive` means `true`.

**Matching:** an exact client id wins over `*`. A valid file with no match gives no scopes.

**What per-client grants don't do:** they do not separate agents that share one sign-in. Every agent signed in as Ken's subject through the same client has the same grant. Real separation needs distinct subjects (sc-2004).

**Reading and integrity.** On every call the entry runs these steps:
1. `lstat` the path. Refuse a symlink or a non-regular file.
2. Check `access(W_OK)` on the file and on its directory. If either is writable by the server's process, fail closed: replacing a file needs only a writable directory, so the directory check is the defence when a mount differs from the planned `:ro`.
3. If mtime, size and inode match the last good read, reuse it.
4. Otherwise `open` the file once, `fstat` that descriptor (it must still be the same regular file), then read and hash from that same descriptor. A swap between the check and the read can't substitute content.

**Fail closed:** missing, invalid, symlinked, or a writable file or directory means every connection gets `budget:read` only.

Each new fail-closed reason goes to stderr once per change of reason, not once per call, and never with the file's contents.

**Where it lives on the VPS:** in `actual-hosting`, the MCP compose mounts `{{mcp_root}}/grants:/run/mcp-grants:ro` (a directory, so an atomic replace on the host is seen) and sets `ACTUAL_MCP_GRANTS_FILE=/run/mcp-grants/grants.json`. The file is owned by root, mode 0644, and holds no secret: subjects and client ids are identifiers, not credentials.

**Why not the data directory:** the server's uid can write `/data`, so a compromised or confused process could widen its own grant.

**How it is changed (checked against `actual-hosting` on 2026-11-15):**
- No grants Action exists today.
- Production files reach the VPS only through `deploy.yml`. It bundles files from the hosting repo, and production runs only with Ken's Touch ID-signed approval from `scripts/deploy_prod.py`, checked by the VPS's forced command `production/deploy-command.py`.
- So the grants file is committed in `actual-hosting` per environment (`production/mcp/grants.json`, plus the staging copy), added to the deploy bundle, and installed by `deploy-command.py` into `{{mcp_root}}/grants/`.
- A grants change is a hosting PR plus Ken's existing one-button deploy. The server picks it up on the next call, with no container restart.
- The grants files are added to the Security Analyst's row of the review matrix in `docs/agents/team.md`, so widening a grant needs that approval.
- `actual-hosting` CI validates both files against the schema above (unknown scope, duplicate pair, writes on `*`).
- A grants-only deploy mode that skips the image steps would be quicker. It is a later improvement, not needed for this change. If built, it must keep the same signed approval and the same `deploy-command.py` validation, so it never becomes a quicker path around Ken's gate.

### D4. Stdio: writes-only variables

The stdio entry has no OAuth, so its grant comes from three variables, read **only by the `--writes` entry**:
- `ACTUAL_MCP_WRITES_SCOPES`, plus `ACTUAL_MCP_WRITES_CONFIRM_DESTRUCTIVE` (`1` or `0`) and `ACTUAL_MCP_WRITES_MAX_ROWS`.
- They are set in the 1Password Environment "Actual Agents" (the mounted `.env` that both stdio launchers read with `node --env-file`). They are never set in the repo, `.mcp.json` or a shell profile.

**Why the `WRITES_` names:** the read entry loads the same env file. It always grants `budget:read` and ignores these variables, so narrowing the writes entry can't stop the read entry from starting.

**Defaults when unset:** all six scopes, `confirm_destructive` off and `max_rows` 50. That keeps today's behaviour: both category deletes run today without a dry run. An unknown scope stops the writes entry at start.

The grant is read once at start. Stdio entries are restarted per session, which counts as "the next call" for a local process.

**A guard rail, not a boundary.** Any agent with a shell on Ken's machine, or with access to the 1Password environment tools, can edit the launcher or the variables. The stdio grant stops a confused agent, not a hostile one. The README says so.

`--writes` remains, and still decides the data directory (`<env>-writes`) and the engine mode.

### D5. Enforcement in the registration wrapper

`register(name, description, shape, fn, { scopes, destructive })`:

1. Look up the effective grant: the stdio constant, or the hosted per-call lookup passed in through `ServerOptions` as `grant: () => Grant`.
2. If `scopes ⊄ grant.scopes`, throw `Refusal(<fixed text>)` after appending a `refused` audit line (best effort).
3. Run `fn`.

The SDK validates arguments against `inputSchema` before the callback runs, so a malformed call to an ungranted tool gets the SDK's validation error. That is acceptable: the guarantee is "refused before any budget read, audit attempt line or change", not "before validation".

The description gets the suffix `Needs: <scopes>.` and the annotations get `readOnlyHint` or `destructiveHint`.

The read tools run through the same check with `budget:read`, so a grant with no scopes is a fully revoked connection.

The audit log path is now passed to every entry, because the read stdio entry needs it for `refused` lines. That entry already has a spec'd path, `<env>.audit.jsonl`.

### D6. Confirm and row cap as grant options inside `loggedWrite`

**Generic dry run.** A destructive tool computes `entry: { ids, changes }` before `loggedWrite`, as every write already does.
- With `confirm_destructive` on and no `confirm` argument, `loggedWrite` returns `{ dry_run: true, ...entry, confirm }` and writes nothing.
- `confirm` = `<issued-at>.<HMAC-SHA256 over issued-at ‖ subject ‖ client ‖ tool ‖ canonical args (minus confirm) ‖ canonical entry>`, keyed by a per-process random key.
- A call with `confirm` checks the 5-minute lifetime, recomputes `entry` and compares in constant time. A mismatch is refused with "The budget changed since the dry run, the call differs, or the confirm expired. Nothing changed."
- Binding the value to the caller and giving it a lifetime stops an old dry run from being replayed later, by another client, when the state happens to match again.
- Destructive tools gain an optional `confirm` input.

**Why generic:** no per-tool preview code. The comparison covers exactly the values the audit line would record, the same idea as `preview_move_on_budget`.

**Key lifetime:**
- Hosted: the process lives across stateless requests, so one key per process is enough. A restart invalidates outstanding dry runs, which is fine.
- Stdio: one key per process.

`write_move_on_budget` keeps its own preview-based confirm, unchanged.

**Row cap:** `min(grant.max_rows ?? 50, 50)` replaces `MAX_WRITE_ROWS` at the point where it is checked.

**Why this order** (scope → confirm → row cap → audit attempt → write): a refused call writes no attempt line and costs no budget read.

### D7. Audit lines

Attempt, outcome and refused lines add `scopes` (the effective list). On the hosted entry they also add `grant`, the first 12 hex characters of the SHA-256 of the grants file bytes, or `none` when failing closed. A changed grant is then visible in the log.

A `refused` line holds no arguments, because arguments can carry budget data and a refusal must stay cheap.

## Risks / Trade-offs

- **Prompt injection reaches further.** Once deletes and amount edits exist, injected bank, payee or notes text can now steer a destructive call. `confirm_destructive` protects only against mistakes; a compromised model can run the dry run and the real call in one turn. Mitigations:
  - The `destructiveHint` annotations and the `write_` prefix let clients prompt.
  - Ken's clients must not auto-allow destructive tools.
  - The day-one production grant (Ken, 2026-11-15) leaves out `delete` until undo (sc-4215) ships, and lowers `max_rows` to 10.
  - Undo (sc-4215) is the recovery path.
- **The production assistant loses writes if its grant isn't installed before the release.** The rollout installs the grants file first (tasks group 4). Because of fail-closed, a mistake degrades to read-only, never to "all".
- **Confused deputy.** Per-client grants do not separate agents sharing one sign-in: every agent signed in as Ken's subject through the same client has the same grant. Writes go only to named client ids, never `*`. The scopes never exceed the non-admin sync-server user the entry runs as. Real separation needs distinct subjects (sc-2004).
- **Integrity of the grants file.** Whoever is root on the VPS, or can merge to `actual-hosting` and get Ken's signed deploy, can widen grants. That is Ken's gate plus a Security Analyst review. The grant fingerprint on every audit line makes a change visible. The server refuses a file or directory it could rewrite, and a symlink.
- **Stdio grant changes need a restart.** This is accepted, because a stdio entry lives for one client session.
- **A dry-run `confirm` is replayable within the same process** for identical args and identical budget state. That is harmless: replaying it performs the change it described, and the state check makes a second delete fail as "not found".

## Migration Plan

1. Archive `mcp-remote-read-write` first: both changes modify the same `mcp-server` requirements, and this delta is written against its text.
2. Ship the code. Stdio entries keep today's behaviour by default (D4). The hosted entry without a grants file becomes read-only.
3. In `actual-hosting`, before the promotion that carries this release:
   - Commit the staging and production grants files.
   - Mount `/run/mcp-grants` read-only and set `ACTUAL_MCP_GRANTS_FILE`.
   - Deploy staging and verify a write on staging.
4. Production: the grants file content is the day-one grant **Ken decided on 2026-11-15** (recorded on sc-4477): every scope except `delete` until sc-4215 ships, `confirm_destructive` true and `max_rows` 10, on the pre-registered client id, with `*` holding `budget:read`. Ken's signed deploy installs it with the release.
5. **Rollback:** promote the previous release. The old image ignores the grants file and serves today's writes.

