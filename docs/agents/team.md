# Agent team and review rules

Fork-only; never upstream.

Ken is the stakeholder.

**Ken's gate:** the only thing that needs a human approval is changing
production (Ken, 2026-10-29). Everything else is decided by the roles.

**Production for now** (Ken, 2026-10-30): production holds no paying customers
yet, so the worst case is wiping it and starting over. Agents avoid connecting
to production, but that is no longer a hard prohibition. Production-hardening
work is deferred: the Security Analyst files such findings as deferred Backlog
stories, not blockers. Changing production (promotion) is still Ken's gate.

## Roles

| Role                              | Owns                                                                                                                                                                  | Doesn't                                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Director** (the lead session)   | Assigns work from the backlog, runs the agents, resolves disputes, merges PRs once approved and green, decides when to cut a release, and arranges meetings with Ken. | Write feature code or approve PRs.                                                                                        |
| **Product Owner**                 | The Shortcut backlog: its vision, order, refinement and acceptance criteria. Decides what is done from the user's point of view.                                      | Change code or specs, or act on GitHub beyond posting review comments.                                                    |
| **Solution Architect**            | OpenSpec designs and specs, ADRs, cross-package structure and shared interfaces.                                                                                      | Implement features.                                                                                                       |
| **Developer** (one or more)       | Implements one story per branch and PR: spec scenario first, then a failing test, then the fix.                                                                       | Merge their own PRs.                                                                                                      |
| **Tester**                        | Test strategy, acceptance against the story and spec, regression and e2e coverage, release checks on staging.                                                         | Fix the code under test; it sends the work back.                                                                          |
| **Release & Operations Engineer** | CI, repository settings, staging deploys and release mechanics, backups and restore tooling, and the `kenlefeb/actual-hosting` repo.                                  | Change production: promotion stays Ken's; avoid connecting to production.                                                 |
| **UX Designer**                   | `PRODUCT.md` and `DESIGN.md`. Designs with the impeccable skill and reviews layout, mobile behavior and copy.                                                         | Implement features.                                                                                                       |
| **Security Analyst**              | Threat review, dependency and scan findings (`yarn npm audit`, Dependabot, Semgrep), secrets, auth, the sync server, hosting and CI.                                  | Accept risk for Ken; it reports the risk to the Director, weighing it against shipping. Production hardening is deferred. |
| **Checklist Reviewer**            | Reviewing every set of instructions meant for Ken (ready-for-human stories, VPS and admin sessions, release and promotion steps) before he's told they're ready.      | Write the checklist it reviews.                                                                                           |

Several Developers may work at once, each in their own worktree on their own
story. Two agents never write the same files at the same time.

## Instructions for Ken

Instructions for Ken must be very explicit (Ken, 2026-10-30). A step like
"install the age public recipient file at the path in the hosting README" is
not usable: it doesn't say what the file is, where it is or what the path is.

The Checklist Reviewer reads every set of instructions meant for Ken before
the Director tells him they're ready. Each checklist must meet this standard:

- Someone unfamiliar with the project can do it.
- Every term is explained the first time it appears.
- Every command can be copied and pasted as written, with full paths.
- Each step says where its inputs come from: a file, a 1Password item or a URL.
- Documentation is quoted or deep-linked, never "see the README".
- Each step ends with a check and the output Ken should expect.
- Where a secret is involved, the step names what must never be pasted or
  copied, and how to recognise it.
- Each step has a "Why you, not an agent" line naming the specific reason, such
  as root on the production host, a credential under Ken's account or a
  physical device.

The reviewer judges each of those reasons and says which one it accepts. Ken's
only gate is changing production (see above), so "needs approval" is not a
reason. A step with no reason, or only that one, goes back to an agent.

The reviewer posts its findings as a story comment that starts with
"Checklist Reviewer:", followed by numbered findings or "Approved".

The same rules as "How to approve" apply:

- The reviewer is a different session from the checklist's author. If the
  author is itself the Checklist Reviewer, a second agent in that role reviews.
- A review counts only when the Director sent the reviewer the checklist and
  the reviewer's report gives the comment's URL.
- The comment is never edited. A new finding or verdict goes in a new comment.

After a finding, the author fixes the checklist and it is reviewed again. The
Director tells Ken nothing until there is an "Approved" comment later than the
latest finding. This covers instructions given to Ken in chat as well as in
stories.

## Who reviews what

These rules govern PRs in both `kenlefeb/actual` and `kenlefeb/actual-hosting`.

Every PR needs **at least one approval from a role that didn't author it**. The
Director isn't a reviewer. Add every row that matches; the docs row applies only
when nothing else does:

| The PR changes                                                                                                                                                          | Required approver                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| App code in `packages/` (not `packages/docs/`)                                                                                                                          | Tester                                                  |
| UI changes in `packages/desktop-client` or `packages/component-library`, or `PRODUCT.md` or `DESIGN.md`                                                                 | + UX Designer                                           |
| Shared interfaces: `loot-core`, the database schema or migrations, sync/CRDT, the public API or CLI, or more than one package                                           | + Solution Architect                                    |
| The sync server, auth, encryption, bank sync, secrets, dependencies or `yarn.lock`, CI workflows, agent hooks, or actual-hosting scripts, Dockerfiles and compose files | + Security Analyst                                      |
| OpenSpec specs or changes, ADRs                                                                                                                                         | Solution Architect (+ Product Owner for product intent) |
| Release PRs: a version bump and fork news, or an actual-hosting source pin and release note                                                                             | Tester                                                  |
| Only docs (including `packages/docs/`), agent rules or test fixtures                                                                                                    | Any one non-author role                                 |

The Release & Operations Engineer may also approve CI workflows and
actual-hosting deploy scripts, but the Security Analyst must still approve them.

If the author is itself a required role (say, the Architect writes a spec),
another required role, or a second agent in the same role, approves instead.

## How to approve

All agents push through Ken's GitHub account, and GitHub won't let an account
approve its own PR. So reviews are PR comments in this exact form:

- `🤖 **Approved** — <Role>`, followed by what was checked.
- `🤖 **Changes requested** — <Role>`, followed by numbered findings. Each
  finding names the file and line and gives a concrete failing case.

Posting a review comment is the only thing the Product Owner does on GitHub.

On a shared account the role in a comment is only a claim, so a review counts
only when:

- the Director sent that reviewer the PR, and the reviewer's report to the
  Director gives the comment's URL;
- the reviewer isn't the session that authored the PR;
- the comment was never edited. A new finding or verdict goes in a new comment.

A PR is approved when every required role has a counted `Approved` comment
later than its latest `Changes requested`, and no commits were pushed after the
approval except merges of `development`.

An approval also completes the story's "Code review" task. The reviewer ticks
it, as the owner of that task, and comments on the story with the approval
comment's URL. Every agent uses one Shortcut user, so that link is what shows
the review wasn't the author's.

A story with several PRs (say, a spec PR and then an implementation PR) has its
"Code review" task ticked by the reviewer of the PR that finishes the story's
last open task. The approvals of the earlier PRs are linked on the story.

Older stories' task text may still say "a person reviewed the PR". The rule in
this file wins.

## Merging

This section is how primer rule 27, "Green merges itself", applies to this
team: a PR merges itself once it is both approved and green.

- Open PRs without auto-merge.
- Once a PR is approved, the Director turns on auto-merge. Only in a repo that
  has no required check at all does the Director merge it directly. Required
  checks are never removed in order to merge.
- A failing check or unresolved `Changes requested` blocks the merge. Nobody
  merges past it.
- A red Fork CI push run on `development` stops the line. The Director pauses
  merges into `development` until a fix or a revert lands and its push run is
  green.

## Repository settings

Settings changes aren't PRs, so they don't go through the review matrix. A
change to branch protection, required checks, Actions enablement or repository
secrets needs a Security Analyst approval, recorded as a comment on its Shortcut
story, before it's made. The story also records a snapshot of the old settings
and the rollback command. sc-568 is the example.
