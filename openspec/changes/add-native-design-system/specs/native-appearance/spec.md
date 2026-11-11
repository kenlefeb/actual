# Spec Delta

## Purpose

How the native "Home Economics" apps on iPhone (Capacitor) and Mac (Electron) look and navigate, while the web app in a browser keeps upstream Actual's look. The design rules behind these requirements are in `DESIGN.native.md`.

## ADDED Requirements

### Requirement: The native apps use the Home Economics theme
Inside the iOS app and the Mac app, the app SHALL use the Home Economics theme: the system font, Apple's semantic colours and the Hearth Teal accent. In a browser, on any device, the app SHALL keep upstream's themes and theme setting unchanged.

#### Scenario: iPhone app
- **GIVEN** the Home Economics app is open on an iPhone
- **WHEN** the budget screen shows
- **THEN** its text uses the system font, its page background is the system grouped background, and primary actions use the Hearth Teal accent

#### Scenario: Mac app
- **GIVEN** the Home Economics app is open on a Mac
- **WHEN** the budget page shows
- **THEN** its text uses the system font and its primary actions use the Hearth Teal accent, unless the user picked a system accent colour in System Settings

#### Scenario: The browser is unchanged
- **GIVEN** the same server opened in a desktop browser and in a phone browser
- **WHEN** the budget page shows
- **THEN** it uses upstream's theme and fonts, and Settings still offers upstream's theme choices

### Requirement: The native apps follow the system appearance
Inside the native apps, light or dark SHALL follow the device's appearance setting and SHALL change when that setting changes, without a restart. The native apps SHALL NOT offer upstream's theme picker; the Midnight and custom themes are not available there.

#### Scenario: iPhone switches to dark
- **GIVEN** the iOS app is open in light appearance
- **WHEN** the user turns on Dark Mode in Control Center
- **THEN** the app switches to the dark Home Economics theme while open, and the status bar text stays legible

#### Scenario: Mac switches to dark
- **GIVEN** the Mac app is open in light appearance
- **WHEN** the user picks Dark in System Settings › Appearance
- **THEN** the app switches to the dark Home Economics theme while open

#### Scenario: No theme picker in the native apps
- **WHEN** the user opens Settings in the iOS app or in the Mac app
- **THEN** there is no theme choice, and Settings in a browser still has one

### Requirement: Amounts stay legible and never rely on colour alone
In the native apps, every amount SHALL use tabular digits, SHALL show its sign, and SHALL NOT truncate. A negative category balance SHALL also be named in words, such as "Overspent". Text and amounts SHALL meet WCAG 2.1 AA contrast in light and dark.

#### Scenario: Overspent category on iPhone
- **GIVEN** the category "Dining out" has spent $238.20 of $200.00 in the iOS app
- **WHEN** the budget screen shows the category
- **THEN** its balance reads "−$38.20" in red, and its detail line includes "Overspent"

#### Scenario: Overspent category on Mac
- **GIVEN** the same category in the Mac app
- **WHEN** the budget page shows it
- **THEN** its balance reads "−$38.20" with tabular digits, in the negative colour

#### Scenario: Contrast in both appearances
- **WHEN** the theme contrast test runs on the Home Economics light and dark themes
- **THEN** every text and amount colour pair meets 4.5:1

### Requirement: Text follows Dynamic Type on iPhone
In the iOS app, text SHALL follow the user's text-size setting (Dynamic Type), including the accessibility sizes. At any size, names and detail lines MAY wrap or truncate, but amounts SHALL show in full. The Mac app SHALL use the macOS text sizes.

#### Scenario: Largest accessibility size on iPhone
- **GIVEN** the iPhone's text size is set to the largest accessibility size
- **WHEN** the budget screen shows
- **THEN** the text is larger, every balance shows in full, and long category names wrap or truncate

#### Scenario: Mac text size
- **WHEN** the budget page shows in the Mac app
- **THEN** body text uses the macOS body size, and the money table keeps its columns

### Requirement: iPhone uses a native tab bar
In the iOS app, the main sections SHALL be in a native tab bar drawn by iOS: Budget, Accounts, Reports and Settings, with a separate Add button that opens a new transaction. The web tab grid SHALL NOT show in the iOS app. Saving a transaction and moving money SHALL give haptic feedback when the system allows it. In a phone browser, the existing tab grid SHALL remain.

#### Scenario: Switching sections on iPhone
- **GIVEN** the iOS app is on the Budget tab
- **WHEN** the user taps Accounts in the tab bar
- **THEN** the accounts screen shows, the Accounts tab is selected, and tapping Budget returns to the budget where it was

#### Scenario: Adding a transaction on iPhone
- **WHEN** the user taps the Add button next to the tab bar and saves a transaction
- **THEN** the new-transaction screen opens, saving gives a light haptic tap, and the user returns to the screen they came from

#### Scenario: Phone browser keeps the web tab grid
- **WHEN** the same server is opened in Safari on an iPhone
- **THEN** the web tab grid shows, and there is no native tab bar

### Requirement: Mac uses native window chrome and a menu bar
In the Mac app, the window SHALL use an inset title bar with the system's sidebar material, its title SHALL name the current view rather than the app, and the menu bar SHALL hold the main commands with keyboard shortcuts. This requirement is Mac-only; on iPhone the tab bar requirement covers navigation.

#### Scenario: Window title names the view
- **WHEN** the user opens Accounts in the Mac app
- **THEN** the window title reads "Accounts", not "Home Economics"

#### Scenario: Add a transaction from the menu bar
- **GIVEN** an account is open in the Mac app
- **WHEN** the user chooses the menu command for a new transaction, or presses its shortcut
- **THEN** a new transaction row opens for editing in that account

### Requirement: The native apps carry the Home Economics brand
The iOS and Mac apps SHALL show the name "Home Economics" and the jar-of-coins app icon (direction A). The icon SHALL be a layered Icon Composer file, so that the system provides its dark, tinted and clear variants.

#### Scenario: iPhone Home Screen
- **WHEN** the app is installed from TestFlight on an iPhone
- **THEN** the Home Screen shows the jar-of-coins icon labelled "Home Economics", and it follows the Home Screen's dark and tinted icon styles

#### Scenario: Mac Dock
- **WHEN** the Mac app is running
- **THEN** the Dock and the app switcher show the same jar-of-coins icon, and the menu bar names the app "Home Economics"
