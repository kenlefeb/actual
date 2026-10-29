# Design

## Context

See proposal.md and specs/business-calendars/spec.md. Desktop calendar management is `components/modals/BusinessCalendarsModal/`: a modal with a calendar list (plus "New calendar" and preset buttons) beside `BusinessCalendarEditor`, which owns the draft, validation, year preview and Save/Delete. Its only entry point is a button on the desktop Schedules page, hidden on narrow layouts. On narrow layouts `/schedules` renders `MobileSchedulesPage` instead. (The account "Business days" dialog only assigns a calendar; it does not open calendar management.)

The fork already moved one modal to mobile pages: paychecks (sc-60) open through `useOpenPaycheck()` (`components/schedules/PaycheckRow.tsx`), which navigates to `/paychecks/:id` on narrow widths and pushes the modal otherwise; the route is wrapped in `WideNotSupported redirectTo="/schedules"` and a `NarrowAlternate` name exported from `responsive/narrow.ts` and `responsive/wide.ts`.

## Goals / Non-Goals

**Goals:**
- Phone users can do everything the desktop dialog does.
- One implementation of the editing rules, so desktop and mobile cannot drift.

**Non-Goals:**
- New rule kinds or presets, server or data changes, a redesigned desktop dialog.

## Decisions

### Reuse `BusinessCalendarEditor` on the mobile page
The mobile editor page wraps the existing `BusinessCalendarEditor` in a mobile `Page` with `MobilePageHeader` and a back button. The editor already lays out each rule as a wrapping row, so it fits a phone width. This guarantees the same capabilities (including Easter rules and offset validation) and keeps a single tested editor.

- Alternative: a separate mobile editor built from collapsible sections like the paycheck page. Rejected for now: it doubles the editing logic for no new capability. Mobile-specific styling can be added to the shared editor later.

### Routes and opening
- `/business-calendars`: the list (`MobileBusinessCalendarsPage`).
- `/business-calendars/:id`: the editor (`MobileBusinessCalendarPage`).
- Both are narrow-only (`WideNotSupported redirectTo="/schedules"`), following `/paychecks/:id`.
- `useOpenBusinessCalendars()` navigates to `/business-calendars` on narrow layouts and pushes the `business-calendars` modal otherwise, following `useOpenPaycheck`. The desktop Schedules button and the new mobile Schedules control both use it.

### Creating calendars
As on desktop, "New calendar" and "Copy … preset" create the calendar immediately through the existing create mutation; on mobile the app then opens the new calendar's editor.

### Save and delete
Save and delete use the existing update and delete mutations and then return to the list, as the mobile paycheck page returns after saving. Delete has no extra confirmation, matching desktop.

### Feature flag
The Schedules control appears only when `businessCalendars` is on. The two pages also send a user to `/schedules` when the flag is off, so a stale link cannot reach them.

## Decisions for Ken

- **Reused the desktop editor component** instead of building a phone-specific editor. Same features and validation by construction; the layout is the desktop one wrapped to phone width, not a bespoke mobile design.
- **Entry point is a button on the mobile Schedules page**, under the search bar, matching where the desktop button lives. No new entry in the mobile navigation or settings.
- **Save returns to the list**, as the mobile paycheck editor does. Desktop stays on the calendar.
- **Pages are gated by the flag too**, not only the entry point (paychecks gate only the entry point).
- **No Playwright e2e.** The pages are covered by component tests; an e2e would need the flag on and calendar data, which no existing mobile e2e sets up, and e2e cannot run locally here.
- **No upstream release note**, following the `business-calendars` precedent.

## Risks / Trade-offs

- [Desktop editor is dense on a phone] → Rows wrap; acceptable for an experimental feature. A mobile-specific layout can follow without changing behavior.
