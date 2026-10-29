# Issue tracker: Shortcut

Fork-only (never upstream; see `fork/README.md`). Tickets, specs and backlog
items for this fork live as Shortcut **stories** in workspace `blacksmith-press`,
team "Kenneth LeFebvre's Team", workflow "Spec-Driven Development". Use the
Shortcut connector for every operation. If it isn't available, stop and say so;
don't fall back to GitHub issues.

Spec-Driven Development is the team's only workflow. The old "Standard"
workflow (Backlog → To Do → …) is retired; don't use it or its states. The
team's default workflow in Shortcut settings may still be Standard, so always
pass a Spec-Driven state id.

| State       | ID        | Meaning                                                                   |
| ----------- | --------- | ------------------------------------------------------------------------- |
| Backlog     | 500000219 | Not defined well enough to start; goes through Explore and Propose first. |
| Explore     | 500000225 | Explore only, with `/opsx:explore`; comment, but write no code.           |
| Propose     | 500000226 | Write the OpenSpec change with `/opsx:propose`, then move to Ready to Do. |
| Ready to Do | 500000220 | Ready; start without asking, unless blocked or `ready-for-human`.         |
| In Progress | 500000221 | Being built.                                                              |
| In Review   | 500000222 | PR open.                                                                  |
| Done        | 500000223 | PR merged into `development`.                                             |

Agents pick up only Ready to Do stories that are not blocked and not labelled
`ready-for-human`. A story that is only waiting on a blocker stays in Ready to
Do. Mark it blocked with Shortcut's blocked flag or a `blocked` label, and link
it to the blocking story with a "blocks" relation (`stories-add-relation`).

Story lifecycle (starting, branches, PR links, Done) follows the "Shortcut
stories" section of `AGENTS.md`.

## Conventions

- **Create a story**: `stories-create` with `team` "Kenneth LeFebvre's Team",
  the matching `epic`, and the Spec-Driven Backlog state (500000219). Type
  `bug` for defects, `chore` for maintenance, `feature` otherwise. Search first (`stories-search`) so you
  don't file a duplicate. Use the story template below, including its
  checklist.
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
- **Close**: move the story to Done when its PR merges into `development`. If
  the PR closes without merging, move the story back to Ready to Do and
  comment why. For wontfix, apply `wontfix`, comment why, and archive it. For a
  duplicate, add the "duplicates" relation, comment which story it duplicates,
  and archive it.

## Story template

Every story uses this shape, whoever files it. The description:

```markdown
## Why

The problem or need, in a sentence or two.

## What to build

The scope, and what is out of scope when that helps.

## Acceptance

- Each scenario, or a link to the spec requirement it meets.

## Specs

- `openspec/specs/<capability>/spec.md`, or "none".
```

A `bug` story replaces "What to build" with "What's wrong" (steps, expected,
actual) and names the spec and requirement it breaks.

Right after creating the story, add the checklist as Shortcut tasks
(`stories-add-task`), in this order:

1. Spec: OpenSpec change proposed or updated
2. Tests: failing tests written first
3. Build: implementation done
4. Checks: lint, typecheck and tests pass
5. Self-review: the author read the whole diff
6. Code review: a person reviewed the PR
7. Release note or fork news, if user-facing
8. Archive: OpenSpec change archived, if this is its last story

**Who did each step.** Shortcut keeps a task's owners and completion time, not
who ticked it. So whoever finishes a step completes the task and sets
themselves as its only owner in the same `stories-update-task` call
(`isCompleted: true`, `taskOwnerIds: [<your user id>]`; `users-get-current`
gives the id). A step that doesn't apply is completed the same way with its
description changed to start with `n/a:` and the reason, for example
`Spec: n/a: no behavior change`.

- Agents act through the Shortcut account the connector is signed in as, so a
  task owned by that account was done by an agent.
- "Code review" is a person's step: an agent never completes it. A reviewer
  completes it after approving the PR, or Ken completes it when he has read
  the diff. "Self-review" is the author's, agent or person.
- Before moving a story to Done, every task is complete; an unfinished one
  stays open with a comment saying why.

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
  the proposal's Why and fill `x-shortcut`. A story in Propose then moves to
  Ready to Do.
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
- **Frontier query**: the epic's stories in Spec-Driven Ready to Do
  (500000220) that aren't blocked, have no owner and aren't labelled
  `ready-for-human`. First in epic order wins.
- **Claim**: `stories-assign-current-user`, then move the story to In Progress.
  Do this before any other write.
- **Resolve**: comment the answer, move the story to Done, then add a context
  pointer (gist + link) to the epic's Decisions-so-far.
