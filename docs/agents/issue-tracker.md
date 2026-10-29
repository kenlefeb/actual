# Issue tracker: Shortcut

Fork-only (never upstream; see `fork/README.md`). Tickets, specs and backlog
items for this fork live as Shortcut **stories** in workspace `blacksmith-press`,
team "Kenneth LeFebvre's Team", workflow "Standard" (Backlog → To Do → In
Progress → In Review → Done). Use the Shortcut connector for every operation. If
it isn't available, stop and say so; don't fall back to GitHub issues.

Story lifecycle (starting, branches, PR links, Done) follows the "Shortcut
stories" section of `AGENTS.md`.

## Conventions

- **Create a story**: `stories-create` with `team` "Kenneth LeFebvre's Team",
  the matching `epic`, and the Backlog state. Type `bug` for defects, `chore`
  for maintenance, `feature` otherwise. Search first (`stories-search`) so you
  don't file a duplicate.
- **Epics**: product areas #469 Business calendars & schedule dates, #28
  Paychecks and #470 Baseline fork behavior; work streams #27 Fork maintenance
  & hosting and #26 Upstream contributions. Ask before creating a new epic.
  Which epic owns each spec is under "OpenSpec changes and specs" below.
- **Read a story**: `stories-get-by-id`, including its comments and relations.
- **List stories**: `stories-search` filtered by `epic`, `label`, `state` or
  `team`.
- **Comment**: `stories-create-comment`.
- **Apply / remove labels**: `stories-update` with the story's full label list.
  Area labels in use: `actual-hosting`, `mobile`, `upstream`, and one
  `spec:<capability>` label per spec a story touches.
- **Close**: move the story to Done when its PR merges into `development`. For
  wontfix, apply `wontfix`, comment why, and archive it. For a duplicate, add
  the "duplicates" relation, comment which story it duplicates, and archive it.

## OpenSpec changes and specs

OpenSpec (`openspec/`) owns what the app does: requirements, scenarios, design
decisions and each change's task checklist. Shortcut owns work state: owner,
status, priority, epic, PR links and discussion. Link the two by id; never copy
requirement text into a story or status into OpenSpec.

| Epic                                     | Specs (`openspec/specs/<capability>/`)                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| #469 Business calendars & schedule dates | `business-calendars`, `schedule-business-days`, `schedule-relative-dates`                                                |
| #28 Paychecks                            | `paychecks`, `account-business-days`, `paycheck-planning`                                                                |
| #470 Baseline fork behavior              | `transaction-notes`, `split-transaction-editing`, `mobile-note-links`, `mobile-sync-status`, `api-transaction-mutations` |
| #27 Fork maintenance & hosting           | `fork-release-news`                                                                                                      |

A new capability joins the epic of its product area: add it to this table, the
epic description and a new `spec:<capability>` label. Upstream delivery of a
spec is a story in #26 that carries the same `spec:` label.

- **One story per change**, or one per numbered `tasks.md` group when groups
  ship as separate PRs. Requirements are not stories; their scenarios are the
  story's acceptance criteria. A bug is one story naming the spec and the
  requirement it breaks.
- **Change → story**: the change's `.openspec.yaml` holds
  ```yaml
  x-shortcut:
    epic: 28
    stories: [56, 57]
  ```
  Keep the `x-` prefix (OpenSpec warns about unprefixed unknown keys) and this
  exact shape (the check reads only it). With several stories, end each
  numbered `tasks.md` group heading with its story, e.g.
  `## 2. Paychecks section (sc-57)`.
- **Story → change**: an external link to
  `https://github.com/kenlefeb/actual/tree/development/openspec/changes/<name>`,
  the spec paths in the description, and the `spec:` labels.
- **Propose** (`/opsx:propose`) only for an existing story; put `sc-<id>` in
  the proposal's Why and fill `x-shortcut`.
- **Apply**: the story moves to In Progress; the PR names the story in its
  branch (`sc-<id>`) or title (`[sc-<id>]`).
- **Unplanned work** outside the story's acceptance criteria gets its own story
  first, related to the current one.
- **Archive** (`/opsx:archive`) when the change's last story merges. Then move
  each story's change link to `openspec/changes/archive/<date>-<name>`, and
  file a Backlog story for every follow-up, deferred item or open "Decisions
  for Ken" entry (or mark it "not planned" in the design).
- **Check**: `yarn check:openspec-shortcut` runs in Fork CI. It fails when a
  change (active or archived) lacks `x-shortcut`, when a multi-story change's
  group heading lacks a listed story, and when a PR ticks a change's tasks
  without naming one of its stories. With `--require-story`, which Fork CI
  passes, it also fails any PR whose title and branch name no story (bot PRs,
  such as Dependabot's, are exempt), so every change is accounted for in
  Shortcut.

`openspec/config.yaml` carries the same rules, so the `/opsx:*` skills relay
them; don't edit the generated skills, which `openspec update` overwrites.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external
PRs as feature requests; `/triage` reads this flag.)_

## When a skill says "publish to the issue tracker"

Create a Shortcut story as above.

## When a skill says "fetch the relevant ticket"

Read it as in **Read a story** above. References look like `sc-<id>`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a Shortcut epic, and its stories are the
tickets.

- **Map**: an epic whose description holds the Notes / Decisions-so-far / Fog.
- **Child ticket**: a story in that epic, labelled `wayfinder:<type>`
  (`research`/`prototype`/`grilling`/`task`).
- **Blocking**: Shortcut's native story relation, added with
  `stories-add-relation` ("blocks"). A ticket is unblocked when every blocker is
  Done.
- **Frontier query**: the epic's stories not Done, with no open blocker and no
  owner. First in epic order wins.
- **Claim**: `stories-assign-current-user`, then move the story to In Progress.
  Do this before any other write.
- **Resolve**: comment the answer, move the story to Done, then add a context
  pointer (gist + link) to the epic's Decisions-so-far.
