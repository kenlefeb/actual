# Proposal: telling agents apart from each other and from Ken

Draft, 2026-10-30. Not adopted yet. Fork-only.

## The problem

Every agent works through Ken's accounts. On GitHub, every commit, PR, comment
and merge is authored by Kenneth LeFebvre. In Shortcut, all agents share one
user (Abdul Wakil), so agent vs Ken shows there, but not which role. On the
VPS, agents use Ken's SSH key.

`team.md` works around this with claims: `🤖` comments, `<Role>` in review
comments, and a rule that a review counts only when the Director can link it.
That makes "who did this" a matter of trusting the text. It also means GitHub
can't enforce reviews: one account can't approve its own PR, so approvals are
comments that branch protection can't see.

The [Agent Identity Protocol](https://github.com/openagentidentityprotocol)
doesn't fix this for us. It only sees MCP tool calls, and most agent activity
goes through `git`, `gh` and SSH.

## Goals

1. Anyone reading the history can tell an agent's action from Ken's.
2. They can tell which role did it, and which session of that role.
3. Where possible, the platform says so, not the text the agent wrote.

## Identity format

Each agent session gets a **handle** from the Director when it's spawned:
`<role>-<n>`, numbered within the day, e.g. `dev-3`, `tester-1`, `po-1`. A
replacement session gets a new number. The Director logs each handle with its
start time and story in the session's `.remember/` notes.

| Role               | Handle prefix |
| ------------------ | ------------- |
| Director           | `director`    |
| Product Owner      | `po`          |
| Solution Architect | `architect`   |
| Developer          | `dev`         |
| Tester             | `tester`      |
| Release & Ops      | `ops`         |
| UX Designer        | `ux`          |
| Security Analyst   | `security`    |
| Checklist Reviewer | `checklist`   |

## Tier 1: labels everywhere (no new accounts, start now)

This covers goals 1 and 2. It still rests on claims, but they are consistent
and searchable.

**Commits** get two trailers alongside `Co-Authored-By`:

```
[AI] refine(paychecks): round percent splits to net pay

Agent-Role: Developer
Agent-Session: dev-3
Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

Query with `git log --format='%h %(trailers:key=Agent-Session,valueonly) %s'`.
A commit with no `Agent-Session` trailer is Ken's. The trailers survive only
because this repo merges PRs with merge commits; a squash merge would drop them.

**GitHub comments and reviews** add the handle:
`🤖 **Approved** — Tester (tester-1)`.

**Shortcut comments** start with the role and handle:
`Tester (tester-1): …`. This extends the existing `Checklist Reviewer:` rule.

**Enforcement:** `git-guard.sh` rejects an `[AI]` commit without both trailers,
and `github-comment-style.sh` rejects a 🤖 comment without a `(<handle>)`.

The hooks don't have to take the agent's word for its role. Claude Code gives
every hook an `agent_id` (unique to each subagent) and an `agent_type` (the
subagent's agent name) ([hooks docs](https://code.claude.com/docs/en/hooks.md)).
`agent_id` is set only inside a subagent, so a missing `agent_id` means the
Director. (`agent_type` is also set for a lead session started with `--agent`,
so it isn't the test.) Today the team agents are spawned as generic agents, so their
`agent_type` doesn't name a role. To make it do so:

- Define each role as a Claude Code agent in `.claude/agents/<role>.md`, with
  the role brief that's now pasted into each spawn prompt. The Director spawns
  `subagent_type: "tester"` instead of a generic agent with a Tester brief.
- `git-guard.sh` then rejects a commit whose `Agent-Role` trailer doesn't match
  the hook's `agent_type`, and appends `agent_id`, the handle, the role and the
  commit subject to a local log. That log ties each handle to one real
  subagent, and `git-guard.sh` rejects a handle already bound to a different
  `agent_id`, so `dev-3` can't sign as `dev-2`.

The labels are still text, and Ken's account could write any of them. But an
agent can no longer sign another role's name, whether by mistake or after a
prompt injection.

## Tier 2: a GitHub App per role (the platform says who)

This covers goal 3 on GitHub, where it matters most.

Ken registers one GitHub App per role (`kenlefeb-actual-developer`,
`kenlefeb-actual-tester`, …) and installs each one on `kenlefeb/actual` and
`kenlefeb/actual-hosting` with only the permissions that role needs. Each App's
private key is stored in the 1Password "Ken & Agents" vault.

An agent mints a one-hour installation token for its role's App and uses it as
`GH_TOKEN` for `gh` and as the push credential. Its PRs, comments and reviews
show the bot's name. The token doesn't change the git author, so the helper
also sets `user.name` and `user.email` to the bot's noreply identity; then its
commits are authored as `kenlefeb-actual-developer[bot]`.

What this gets us:

- **Agent vs Ken is shown by GitHub.** Anything from a `[bot]` account is an
  agent. Anything from `kenlefeb` is Ken.
- **Real PR reviews.** The Tester App can approve a PR opened by the Developer
  App, because they are different actors. Branch protection can then require
  approvals, and the "review counts only when…" rules in `team.md` mostly
  become GitHub settings.
- **Least privilege per role.** For example, the Product Owner App can comment
  but can't push, and only the Ops App can edit workflows.
- **Revocation.** Suspending one App cuts off one role without touching Ken's
  token.

What it costs:

- Setup work Ken must do himself: register and install the Apps under his
  account, and approve their permissions. (Why Ken: the Apps are owned by his
  GitHub account.) The Checklist Reviewer reviews that checklist first.
- A small helper script that mints a token from the App key. It's new code on
  the secrets path, so the Security Analyst reviews it.
- Every App key sits in "Ken & Agents", which every agent can read, so any
  agent could mint another role's token. Role separation on GitHub is only as
  strong as that; the pilot should look at limiting which key a session can
  fetch.
- Sessions of the same role still share an App. The `Agent-Session` trailer and
  comment handle from tier 1 still tell `dev-2` from `dev-3`.

GitHub's terms allow only one free machine-user account per person, so Apps,
not extra user accounts, are the way to get several identities.

## Tier 3: other systems (cheap wins, as needed)

- **VPS / staging:** give each role that needs SSH (Ops, sometimes Tester) its
  own key pair with a comment like `ops-agent`. `sshd` logs the key fingerprint
  of each login, so `auth.log` shows which key was used. Ken's own key stays
  his.
- **Shortcut:** keep the shared agent user and use the tier 1 comment prefix. Once tier 2 is
  in, the story's "Code review" task links a real GitHub review by a bot, which
  shows the reviewer wasn't the author. Extra Shortcut users only if the plan
  allows it and the labels prove not to be enough.
- **MCP connectors:** if a connector is risky (Hostinger, Porkbun), an AIP proxy
  in front of it can require approval for writes and keep a JSONL log of every
  call. Optional, and separate from attribution.

## Proposed rollout

Each step becomes a Shortcut story, filed by the Product Owner.

1. **Tier 1 labels.** Add the `.claude/agents/<role>.md` definitions, and
   update `team.md`, the commit skill and the two hooks.
   Reviewers: Security Analyst (agent hooks), any non-author role (docs).
2. **Tier 2 pilot with the Tester App only.** Ken registers one App, the token
   helper lands, and Tester reviews become real GitHub approvals. Run it for a
   week of PRs.
3. **Tier 2 for every role,** then turn on required approvals in branch
   protection, and say in `team.md` which review rules stay conventions. Repository settings need a Security Analyst approval on the
   story, a snapshot of the old settings and a rollback command, as in sc-568.
4. **Per-role SSH keys** on staging, with the Release & Operations Engineer.

## Open decisions

Neither touches production, so the roles decide them while refining the tier 2
story: the Solution Architect, with the Security Analyst for permissions.

1. One App per role (recommended), or one shared "agents" App, which shows only
   agent vs Ken.
2. Whether the Director merges with its own App or with Ken's token.
   Recommended: its own App, so every merge by an agent is labelled as one.
