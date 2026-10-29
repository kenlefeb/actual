# Agent team and review rules

Fork-only; never upstream.

Ken is the stakeholder. He keeps one gate for himself: promoting to production.
The agents do everything else.

## Roles

| Role                            | Owns                                                                                                                                                                  | Doesn't                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **Director** (the lead session) | Assigns work from the backlog, runs the agents, resolves disputes, merges PRs once approved and green, cuts releases, deploys to staging. Arranges meetings with Ken. | Write feature code or approve PRs.                        |
| **Product Owner**               | The Shortcut backlog: its vision, order, refinement and acceptance criteria. Decides what is done from the user's point of view.                                      | Change code, specs or GitHub.                             |
| **Solution Architect**          | OpenSpec designs and specs, ADRs, cross-package structure and shared interfaces.                                                                                      | Implement features.                                       |
| **Developer** (one or more)     | Implements one story per branch and PR: spec scenario first, then a failing test, then the fix.                                                                       | Merge their own PRs.                                      |
| **Tester**                      | Test strategy, acceptance against the story and spec, regression and e2e coverage, release checks on staging.                                                         | Fix the code under test; it sends the work back.          |
| **Security Analyst**            | Threat review, dependency and scan findings (`yarn npm audit`, Dependabot, Semgrep), secrets, auth, the sync server, hosting and CI.                                  | Accept risk for Ken; it reports the risk to the Director. |

Several Developers may work at once, each in their own worktree on their own
story. Two agents never write the same files at the same time.

## Who reviews what

Every PR needs **at least one approval from a role that didn't author it**. The
Director isn't a reviewer. Add every row that matches:

| The PR changes                                                                                                                                                              | Required approver                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Any app code (`packages/`)                                                                                                                                                  | Tester                                                  |
| Shared interfaces: `loot-core`, the database schema or migrations, sync/CRDT, the public API or CLI, or more than one package                                               | + Solution Architect                                    |
| The sync server, auth, encryption, bank sync, secrets, dependencies or `yarn.lock`, `.github/workflows/`, agent hooks, or actual-hosting deploy, backup and restore scripts | + Security Analyst                                      |
| OpenSpec specs or changes, ADRs                                                                                                                                             | Solution Architect (+ Product Owner for product intent) |
| Release PRs (version bump, fork news, hosting pin)                                                                                                                          | Tester                                                  |
| Only docs, agent rules or test fixtures                                                                                                                                     | Any one non-author role                                 |

A Developer may approve another Developer's PR only when it's a small change to
UI text or styling, and the Tester still approves anything else in it.

If the author is itself a required role (say, the Architect writes a spec),
another required role, or a second agent in the same role, approves instead.

## How to approve

All agents push through Ken's GitHub account, and GitHub won't let an account
approve its own PR. So reviews are PR comments in this exact form:

- `🤖 **Approved** — <Role>`, followed by what was checked.
- `🤖 **Changes requested** — <Role>`, followed by numbered findings. Each
  finding names the file and line and gives a concrete failing case.

A PR is approved when every required role has a later `Approved` comment than
its latest `Changes requested`, and no commits were pushed after the approval
except merges of `development`.

## Merging

- Open PRs without auto-merge.
- The Director turns on auto-merge, or merges, only once the PR is approved and
  CI is green.
- A failing check or unresolved `Changes requested` blocks the merge. Nobody
  merges past it.
