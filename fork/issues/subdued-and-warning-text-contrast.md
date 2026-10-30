# [Bug]: Subdued text and light-theme warning text are below WCAG AA contrast

- Status: ready to file
- Type: Bug report
- Checked against upstream `master` at `1d9ec2d1d` (theme CSS). The ratios below are computed from `packages/component-library/src/themes/palette.css` and the `light`, `dark` and `midnight` theme files at that commit.
- Screenshots to attach: `images/subdued-text-light-before.jpg` and `images/subdued-text-light-after.jpg`. Both are the Schedules list on a 375px phone in the light theme with the demo budget. The "after" image only sets the two proposed colours.
- Fork tracking: Shortcut sc-1096. Found while fixing the fork's own note in sc-951.

## What happened?

Secondary ("subdued") text is hard to read in all three built-in themes, and warning text is hard to read in the light theme. Both are below the WCAG 2.1 AA minimum contrast for normal text (4.5:1) on the backgrounds they normally sit on.

Two theme tokens cause it:

- `pageTextSubdued` is used in 78 files (135 uses of `theme.pageTextSubdued` under `packages/*/src`). Examples are labels such as "Payee:" and "Account:" in the mobile schedule list, hints and empty-state text. Each theme also aliases it as `buttonBareDisabledText`. Disabled controls are exempt from WCAG contrast, so that alias isn't a failure.
- `warningText` in the light theme is used in 26 files (33 uses of `theme.warningText`).

Measured contrast (WCAG 2.1 relative luminance), today's colour against each background. Where two values share a cell, they're in the order of the column name (for example table, then card):

| Theme    | Token             | Colour              | page | mobile page | table / card | modal / menu |
| -------- | ----------------- | ------------------- | ---- | ----------- | ------------ | ------------ |
| Light    | `pageTextSubdued` | navy300 `#9fb3c8`   | 1.81 | 2.05        | 2.15         | 2.15         |
| Light    | `warningText`     | orange700 `#b88115` | 2.86 | 3.24        | 3.39         | 3.39         |
| Dark     | `pageTextSubdued` | navy500 `#627d98`   | 4.66 | 2.02        | 2.69 / 4.24  | 4.24 / 2.69  |
| Midnight | `pageTextSubdued` | gray400 `#747c8b`   | 2.65 | 4.75        | 4.32         | 3.54         |

Background colours used (theme tokens `pageBackground`, `mobilePageBackground`, `tableBackground`, `cardBackground`, `modalBackground`, `menuBackground`):

- **Light:** page `#e8ecf0`, mobile page `#f7fafc`, and table, card, modal and menu all `#ffffff`.
- **Dark:** page `#080811`, mobile page `#334e68`, table and menu `#243b53`, card and modal `#141520`.
- **Midnight:** page `#373b4a`, mobile page `#080811`, table and card `#141520`, modal and menu `#242733`.

Dark's `warningText` (orange300 `#f5e35d`) and midnight's (orange200 `#fcf088`) pass everywhere: at least 6.59 and 9.52.

### Suggested fix

Change only the token values to existing palette steps of the same hue. Each is the closest step, by perceptual difference, that reaches 4.5:1 on all of the backgrounds above:

| Theme    | Token             | Proposed            | page  | mobile page | table / card | modal / menu |
| -------- | ----------------- | ------------------- | ----- | ----------- | ------------ | ------------ |
| Light    | `pageTextSubdued` | navy600 `#486581`   | 5.12  | 5.80        | 6.08         | 6.08         |
| Light    | `warningText`     | orange800 `#87540d` | 5.35  | 6.06        | 6.36         | 6.36         |
| Dark     | `pageTextSubdued` | navy200 `#bcccdc`   | 12.16 | 5.27        | 7.02 / 11.06 | 11.06 / 7.02 |
| Midnight | `pageTextSubdued` | navy300 `#9fb3c8`   | 5.17  | 9.26        | 8.43         | 6.90         |

That's one changed line per theme for `pageTextSubdued`, plus one line in `light.css` for `warningText`.

- **Light subdued:** navy600 keeps the navy tint of today's secondary text and stays clearly lighter than body text.
- **Light warning:** orange800 is a deeper ochre that still reads as amber, distinct from the error red.
- **Dark subdued:** dark's mobile page background (`#334e68`) is a light slate where even `pageText` only reaches 6.6:1. So any subdued colour that passes there sits between 4.5 and 6.6, close to body text. navy200 (5.27) is the dimmest navy that passes. If more separation is wanted, the lever is a darker dark `mobilePageBackground`, which is beyond a token-value fix.
- **Midnight subdued:** navy300 adds a slight cool tint to today's neutral grey. gray200 also passes but is noticeably brighter.

### How to measure

1. Resolve each token to its hex value through `palette.css` (for example `--color-pageTextSubdued: var(--palette-navy300)` gives `--palette-navy300: #9fb3c8`).
2. Compute the WCAG 2.1 contrast ratio `(L1 + 0.05) / (L2 + 0.05)` from the relative luminance of the text and background colours. Any WCAG contrast checker gives the same numbers, for example the WebAIM Contrast Checker (<https://webaim.org/resources/contrastchecker/>) or the contrast readout in Chrome DevTools' colour picker.
3. Example: light `pageTextSubdued` `#9fb3c8` on light `mobilePageBackground` `#f7fafc` is 2.05:1. AA for normal text needs 4.5:1.

## How can we reproduce the issue?

1. Open Actual on a phone-width window (or <https://edge.actualbudget.org> with device emulation at 375px), choose the light theme in Settings, and load the demo budget.
2. Open Schedules.
3. The "Payee:", "Account:", "Amount:" and "Next:" labels in each schedule use `pageTextSubdued` and are hard to read (2.05:1 here). Compare the two attached screenshots.
4. Switch to the dark theme. On the same page, the labels sit on `mobilePageBackground` `#334e68` at 2.02:1.

## Where are you hosting Actual?

Docker

## What browsers are you seeing the problem on?

Chrome

## Operating System

Mac OSX
