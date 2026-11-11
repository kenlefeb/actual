# Design System: Home Economics (native apps)

Fork-only. This file covers the native apps only: "Home Economics" on iPhone (Capacitor, `packages/mobile-client`) and on Mac (Electron, `packages/desktop-electron`), bundle id `app.homeeconomics.budget`. The web app in a browser keeps upstream Actual's design system in [DESIGN.md](DESIGN.md), and nothing here changes it. Behaviour is specified in `openspec/specs/native-appearance/` (proposed in `openspec/changes/add-native-design-system/`).

- **Figma:** [Home Economics — Native Design System](https://www.figma.com/design/2Ts4fUoFzCWfvubD9vgTWx). The tokens there are Figma variables: "HE Color" (Light/Dark) and "HE Space & Radius" (iPhone/Mac).
- **Decisions:** Ken, 2026-11-11, on Shortcut sc-3483.

## 1. Overview

**North star: "Home Economics, at home on the device."** Calm, trustworthy and practical, the same character as [PRODUCT.md](PRODUCT.md). The look is Apple's, not ours: system font, system colours, system navigation and the system's materials. One brand accent is what makes it ours. The numbers are still the interface.

Rules that carry over from DESIGN.md unchanged:

- **Semantic tokens only.** Components use `theme.*` and never a hex value.
- **Never colour alone for money.**
- **Tabular digits on every amount.**

Four rules are new:

- **The System Draws the Glass.** Liquid Glass (Apple's translucent material for controls and navigation) appears only on chrome the OS draws: tab bar, toolbars, sheets, sidebar and menus. The content layer is opaque. Never imitate glass in CSS with `backdrop-filter` or semi-transparent panels. The HIG says not to use Liquid Glass in the content layer, PRODUCT.md rules out glassmorphism, and only system-drawn glass follows Reduce Transparency, Increase Contrast and the iOS 27 glass slider.
- **Follow the system appearance.** Light or dark comes from the device setting. The native apps don't offer Midnight or custom themes.
- **System text sizes.** On iPhone, text follows Dynamic Type, the user's text-size setting, including the accessibility sizes. Amounts never truncate; rows wrap instead.
- **Two platforms, one system.** Every native rule names its iPhone and its Mac form.

## 2. Brand

- **Name:** "Home Economics" on the device. The App Store record is "Home Economics Budget".
- **Wordmark:** "Home Economics" set in SF Pro Rounded Semibold, in the accent colour.
- **App icon:** direction A, a jar of coins (envelope budgeting). It is delivered as a layered Icon Composer file: an accent background, the jar and the coins as separate foreground layers, and no text. The system then makes the Liquid Glass, dark, tinted and clear variants.

## 3. Colour

The accent is the only brand colour. Everything else is Apple's semantic colour, so the apps match the OS in both appearances.

| Token (Figma)          | Light       | Dark        | Apple equivalent / use                                       |
| ---------------------- | ----------- | ----------- | ------------------------------------------------------------ |
| `brand/accent`         | #0E7C74     | #4FD1C5     | App accent ("Hearth Teal"): primary action, selection, links |
| `brand/on-accent`      | #FFFFFF     | #00201D     | Text and symbols on the accent                               |
| `bg/grouped`           | #F2F2F7     | #000000     | `systemGroupedBackground`: page                              |
| `bg/grouped-secondary` | #FFFFFF     | #1C1C1E     | `secondarySystemGroupedBackground`: cards, rows, sheets      |
| `bg/grouped-tertiary`  | #F2F2F7     | #2C2C2E     | `tertiarySystemGroupedBackground`                            |
| `label/primary`        | #000000     | #FFFFFF     | `label`                                                      |
| `label/secondary`      | #636366     | #AEAEB2     | `secondaryLabel`, made opaque and darker for contrast        |
| `label/tertiary`       | #3C3C43 30% | #EBEBF5 30% | `tertiaryLabel`: placeholders                                |
| `separator`            | #3C3C43 29% | #545458 60% | `separator`                                                  |
| `fill/control`         | #767680 12% | #767680 24% | `tertiarySystemFill`: segmented controls, neutral pills      |
| `money/positive`       | #1F7A35     | #30D158     | Positive amounts, funded balances                            |
| `money/negative`       | #C00013     | #FF7B73     | Negative amounts, overspending                               |
| `money/zero`           | #636366     | #AEAEB2     | Zero balances                                                |
| `money/*-tint`         | 12% / 20%   |             | Balance pill backgrounds                                     |
| `status/warning`       | #C93400     | #FF9F0A     | Underfunded, pending                                         |

**Mapping to code.** The native theme is a pair of fork-only files, `packages/component-library/src/themes/home-economics-light.css` and `home-economics-dark.css`. They set every `--color-*` variable that `theme.ts` reads, using the values above. For example, `buttonPrimaryBackground` uses the accent, `pageBackground` uses `bg/grouped`, `tableBackground` and `cardBackground` use `bg/grouped-secondary`, and `numberPositive` and `numberNegative` use the money colours. Components don't change.

**Contrast.** These values are measured, not estimated:

- The accent is 5.06:1 on white and 4.53:1 on `bg/grouped`.
- The money colours reach at least 4.5:1 on their own tinted pills in both modes.
- Secondary text and zero balances use opaque #636366 (light) and #AEAEB2 (dark) instead of Apple's 60% `secondaryLabel`, which measures only 3.1:1 on `bg/grouped` in light and 4.2:1 on `bg/grouped-tertiary` in dark.

`contrast.web.test.ts` covers both files.

**Mac.** Where macOS applies the user's accent colour (System Settings › Appearance), it replaces ours, except for fixed meanings such as money colours.

## 4. Typography

**Font: the system font (SF Pro).** In CSS this is `-apple-system, system-ui`. The wordmark is the only place SF Pro Rounded appears. Inter is not used in the native apps.

| DESIGN.md role | iPhone text style (Large, default size) | Mac built-in style  | WebKit keyword (iPhone)          |
| -------------- | --------------------------------------- | ------------------- | -------------------------------- |
| Display        | Large Title, 34/41 Bold                 | Large Title 26/32   | n/a (fixed 34, scaled with Body) |
| Headline       | Title 2, 22/28                          | Title 1 22/26       | `-apple-system-title2`           |
| Title          | Headline, 17/22 Semibold                | Headline 13/16 Bold | `-apple-system-headline`         |
| Body           | Body, 17/22                             | Body 13/16          | `-apple-system-body`             |
| (secondary)    | Subheadline, 15/20                      | Subheadline 11/14   | `-apple-system-subheadline`      |
| Label          | Footnote, 13/18                         | Footnote 10/13      | `-apple-system-footnote`         |
| (smallest)     | Caption 1, 12/16                        | —                   | `-apple-system-caption1`         |

- **Money:** the same styles with `font-variant-numeric: tabular-nums`, through `FinancialText` or `styles.tnum` as today.
- **Dynamic Type:** on iPhone, WKWebView resizes the `-apple-system-*` keywords with the user's text size. Mac has no Dynamic Type and uses the fixed built-in sizes.
- **Truncation:** a row truncates its name or detail line, never its amount. At accessibility sizes, rows wrap to two lines.

## 5. Spacing, radii and layout

| Token                   | iPhone          | Mac             | Notes                                   |
| ----------------------- | --------------- | --------------- | --------------------------------------- |
| `space/xs … xxl`        | 4 8 12 16 20 32 | 4 6 10 16 20 24 | 4-pt grid                               |
| `layout/margin`         | 16              | 20              | Screen or window edge to content        |
| `layout/row-min-height` | 44              | 28              | HIG minimum hit target and control size |
| `radius/card`           | 20              | 10              | Inset-grouped sections, cards           |
| `radius/control`        | capsule         | 6               | Buttons                                 |
| `radius/field`          | 12              | 6               | Text fields                             |

Corners inside sheets are concentric with the sheet. Content respects the safe areas, using `env(safe-area-inset-*)` in CSS.

## 6. Materials and elevation

- **Content layer:** opaque grouped backgrounds. Structure comes from inset-grouped sections and hairline separators, not shadows.
- **Chrome layer:** system-drawn, as the native tab bar, the native Mac window, sidebar and menu bar, and Liquid Glass on iOS 26 and later and macOS 26 and later. Web-drawn sheets use an opaque `bg/grouped` surface with system-style corners, a grabber and system dimming. They never use translucency.
- **Primary action:** the accent fills the button background, with the symbol in `brand/on-accent`. Only one prominent action per view.

## 7. Components

- **Category row:**
  - **Layout:** category name in Body, a detail line in Subheadline secondary, and a balance pill.
  - **Balance pill:** tinted green, red or neutral.
  - **Overspent:** a minus sign and the word "Overspent" in the detail line.
  - **Gestures:** a leading swipe moves money, and a trailing swipe hides the category. A tap opens the category sheet.
- **Money cell:** right-aligned with tabular digits. The colour comes from the sign, and the sign is always shown.
- **Form row:** label on the left, value on the right in secondary text, then a chevron. Rows sit in inset-grouped sections.
- **Toolbar buttons:** 44 pt circles drawn by the system. At most one prominent accent button, such as Save.
- **Sheets:**
  - **iPhone:** medium and large detents and a grabber. They dismiss by swipe, with a Cancel ✕ on the left and a prominent ✓ on the right.
  - **Mac:** a window-attached sheet.
- **Navigation:**
  - **iPhone:** a native tab bar with Budget, Accounts, Reports and Settings, plus a separate Add button at the trailing end. Tabs navigate; actions never go in the tab bar. Every screen has a large title.
  - **Mac:** a sidebar with the same four destinations, a unified toolbar with the view's title (never the app name), and a menu bar that holds every command with its keyboard shortcut.
- **Feedback:** on iPhone, haptics confirm saving a transaction and moving money. They respect the system's haptics settings.

## 8. iPhone versus Mac

| Concern    | iPhone                                 | Mac                                                                   |
| ---------- | -------------------------------------- | --------------------------------------------------------------------- |
| Navigation | Native tab bar plus Add button         | Sidebar, unified toolbar, menu bar                                    |
| Density    | 44 pt rows, one column                 | Dense money table kept (DESIGN.md "Money Table"), 28 pt controls      |
| Type       | Dynamic Type                           | Fixed macOS sizes                                                     |
| Accent     | Hearth Teal                            | Hearth Teal, unless the user picked a system accent                   |
| Input      | Touch, swipe actions, system keyboards | Keyboard and pointer first, hover states; touch on touch-display Macs |
| Overlays   | Sheets with detents                    | Window sheets, popovers, menus                                        |

## 9. Do's and Don'ts

### Do

- Route every colour through `theme.*`. The native theme files are the only place Home Economics values live.
- Test light and dark, the largest Dynamic Type size, Reduce Transparency, Increase Contrast and Reduce Motion on iPhone.
- Use the system's controls where a native one exists: tab bar, toolbar, menus and keyboard.
- Keep Mac and iPhone scenarios paired in specs.

### Don't

- Imitate Liquid Glass in CSS.
- Change upstream's web themes, `DESIGN.md` tokens or the browser look.
- Put actions in the tab bar, or title a window with the app's name.
- Truncate an amount or show money by colour alone.
