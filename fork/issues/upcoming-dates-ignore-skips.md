# [Bug]: "Upcoming dates" still lists a date after "Skip next scheduled date"

- Status: ready to file. Not filed; Ken files it.
- Type: Bug report. Each `##` section below is one field of upstream's bug form.
- Reproduced on <https://edge.actualbudget.org>, v26.10.0+1d9ec2d, on 2026-10-29, with the demo budget in Chromium on Linux.
- Related, but not duplicates: #9090 (the wording of "Skip next scheduled date") and #9167 (editing a schedule brings a skipped date back). No open issue covers the preview.

## What happened?

I skipped the next date of a repeating schedule with "Skip next scheduled date". The schedule list then showed the following date as next, as expected. But when I opened the schedule, its "Upcoming dates" list still started with the date I had just skipped.

Expected: "Upcoming dates" starts from the schedule's next date, so the skipped date isn't listed.
Actual: it lists the dates the repeat pattern gives from today, skipped or not, so it looks as if the skip didn't work.

There's no error message.

From the code, the preview comes from `schedule/get-upcoming-dates` (`getUpcomingDates` in `packages/loot-core/src/server/schedules/app.ts`). It gets only the date config and lists occurrences from today, so it never sees the schedule's stored `next_date`.

## How can we reproduce the issue?

1. Go to https://edge.actualbudget.org and click **Try the demo**.
2. Open **Schedules** and click **Add new schedule**.
3. Set **Schedule Name** to `Rent` and **Amount** to `100.00`. Leave the date as it is: it repeats every month on today's day (on 2026-10-29, "Every month on the 29th"). Click **Add**.
4. In the list, Rent's next date is today (10/29/2026) and its status is **Due**.
5. Open Rent's **Menu** and choose **Skip next scheduled date**.
6. The list now shows Rent's next date as 11/29/2026, with status **Scheduled**.
7. Click **Rent** to open it.

Expected: **Upcoming dates** starts with 11/29/2026.
Actual: **Upcoming dates** still lists 10/29/2026 first, then 11/29/2026 and 12/29/2026.

## Where are you hosting Actual?

Other (edge.actualbudget.org)

## What browsers are you seeing the problem on?

Chrome

## Operating System

Linux
