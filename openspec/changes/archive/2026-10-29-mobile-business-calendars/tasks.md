# Tasks

## 1. Contract

- [x] 1.1 Spec delta: calendar management on narrow layouts (`specs/business-calendars/spec.md`); `openspec validate mobile-business-calendars --strict`

## 2. Opening

- [x] 2.1 Add failing tests that `useOpenBusinessCalendars` navigates to `/business-calendars` on narrow widths and pushes the modal on wide widths; add the hook, use it for the desktop Schedules button and add the flag-gated control to the mobile Schedules page

## 3. Mobile pages

- [x] 3.1 Add failing tests for `MobileBusinessCalendarsPage`: lists calendars, creates a new calendar and a preset copy and opens it, disables creating while a create is pending
- [x] 3.2 Add failing tests for `MobileBusinessCalendarPage`: changes a holiday rule to an Easter rule and saves, shows the weekday and offset validation errors, deletes only after confirming, redirects an unknown id to the list; implement both pages with `BusinessCalendarEditor`
- [x] 3.3 Add the routes (`WideNotSupported redirectTo="/schedules"`) and `NarrowAlternate` exports

## 4. Integration checks

- [x] 4.1 Run the business-calendar, schedule and mobile tests in desktop-client, `yarn typecheck` and `yarn lint`
