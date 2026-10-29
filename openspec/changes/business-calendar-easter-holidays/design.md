# Design

## Context

See proposal.md and specs/business-calendars/spec.md. Holiday rules are stored as JSON in `business_calendars.holidays` and evaluated by the pure `ruleDate` in `packages/loot-core/src/shared/business-calendars.ts`, which already returns `null` for unknown kinds. The server validates rules in `server/business-calendars/app.ts`; the desktop editor is `BusinessCalendarsModal/BusinessCalendarEditor.tsx`. Mobile calendar management (sc-38) will build on this rule model.

## Goals / Non-Goals

**Goals:**
- Express Good Friday, Easter Monday and similar days as rules instead of yearly exceptions.
- Keep evaluation pure, deterministic and shared by client and server.

**Non-Goals:**
- Orthodox (Julian) Easter or other movable feasts.
- Mobile editing (sc-38) and new presets.

## Decisions

### Rule shape: `{ kind: 'easter', offset }`, no `month`
The new variant is `{ id, name, observance, kind: 'easter', offset: number }`. `month` moves from the shared rule base into the three date-in-month kinds, because an Easter rule has no month, and a dummy month would be meaningless data that every editor (desktop now, mobile in sc-38) would have to hide.

- Backward compatible: every stored rule of the existing kinds already has `month`; only the TypeScript type changes, and code now narrows on `kind` before reading `month`.
- Alternative: a generic `{ kind: 'movable', base: 'easter-western', offset }`. Rejected as speculative; another base can be its own kind later without a migration.

### Easter computation
Anonymous Gregorian algorithm (Meeus/Jones/Butcher), integer arithmetic only, valid for every Gregorian year. Exported as `getWesternEaster(year)` returning `YYYY-MM-DD`. Tested against the spec's dates, including both extremes (March 22 and April 25).

### Offset range -100 to 100
Covers every common Easter-based observance (Carnival -48, Ash Wednesday -46, Ascension +39, Whit Monday +50, Corpus Christi +60). It also keeps every result inside the adjacent year at most, which `getHolidays` already scans for spill-over.

### Observance
Unchanged: Easter-relative dates go through the same `observedDate` as other rules.

### Editor
"Days from Easter" is a fourth kind option. Choosing it replaces the month, weekday and day controls with a numeric "Days from Easter" input (default 0, -100 to 100). Switching away from it starts the rule in January. All new text is translated; the editor is already reachable only with the `businessCalendars` flag on.

## Decisions for Ken

- **`month` moved off the rule base** (above). No stored data changes; cleaner for sc-38.
- **Offset limited to -100..100.** Easy to widen later; narrowing later could invalidate saved rules.
- **No preset changes.** Neither U.S. preset models Easter-based days as exceptions, so there was nothing to convert, and no new presets were added.
- **Older clients.** On a client without this change, a calendar with an Easter rule evaluates with that rule ignored, and saving that calendar is rejected by the old validator ("Unknown holiday kind"). Acceptable for an experimental fork feature where devices update together.
- **No upstream release note** in this change, following the `business-calendars` precedent (added when preparing the upstream branch).

## Risks / Trade-offs

- [Users expect Orthodox Easter] → Non-goal; the spec says Western (Gregorian). A separate kind can be added later without a migration.
