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
- **Epics**: #27 Fork maintenance & hosting, #28 Calendars, schedules &
  paychecks follow-ups, #26 Upstream contributions. Ask before creating a new
  epic.
- **Read a story**: `stories-get-by-id`, including its comments and relations.
- **List stories**: `stories-search` filtered by `epic`, `label`, `state` or
  `team`.
- **Comment**: `stories-create-comment`.
- **Apply / remove labels**: `stories-update` with the story's full label list.
  Area labels in use: `actual-hosting`, `mobile`, `upstream`.
- **Close**: move the story to Done when its PR merges into `development`. For
  wontfix, apply `wontfix`, comment why, and archive it.

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
