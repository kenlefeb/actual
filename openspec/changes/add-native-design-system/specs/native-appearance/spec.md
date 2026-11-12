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
In the iOS app, a native tab bar drawn by iOS SHALL be the app's root (ADR 11), with Budget, Accounts, Reports and Settings plus a separate Add button for a new transaction. Each tab SHALL host its section's native screen if one exists, and its web screen otherwise. The web tab grid SHALL NOT show in the iOS app but SHALL remain in a phone browser. Saving a transaction and moving money SHALL give haptic feedback when allowed.

#### Scenario: Switching sections on iPhone
- **GIVEN** the iOS app is on the Budget tab
- **WHEN** the user taps Accounts in the tab bar
- **THEN** the accounts screen shows, the Accounts tab is selected, and tapping Budget returns to the budget where it was

#### Scenario: A tab hosts a web or a native screen
- **GIVEN** the Budget section has a native screen and the Accounts section does not
- **WHEN** the user taps Budget and then Accounts
- **THEN** Budget shows the native screen, Accounts shows the web accounts screen, and both show the same balances for the same account

#### Scenario: Adding a transaction on iPhone
- **WHEN** the user taps the Add button next to the tab bar and saves a transaction
- **THEN** the new-transaction screen opens, saving gives a light haptic tap, and the user returns to the screen they came from

#### Scenario: Phone browser keeps the web tab grid
- **WHEN** the same server is opened in Safari on an iPhone
- **THEN** the web tab grid shows, and there is no native tab bar

#### Scenario: iPhone keeps the phone layout in landscape
- **GIVEN** the iOS app on an iPhone is on Budget, Accounts, an account's transactions, Reports or Settings
- **WHEN** the user rotates the iPhone to landscape
- **THEN** the phone layout still shows, with no desktop sidebar and no privacy-mode top bar, the native tab bar is the only navigation, and rotating back to portrait keeps the same screen and selected tab

#### Scenario: Schedules opens from the Settings tab
- **WHEN** the user taps Settings and then Schedules, in portrait or in landscape
- **THEN** the schedules screen shows with the Settings tab selected

#### Scenario: iPad and phone browsers keep the wide layout
- **WHEN** the app is an iPad, or the server is opened in a phone browser in landscape
- **THEN** the wide layout shows as before

### Requirement: Back goes up one level in the iOS app
In the iOS app on iPhone, every screen except a tab root SHALL have one fixed parent screen within its own tab, and Back SHALL go to that parent, never follow browser history and never change the selected tab. A tab root SHALL show no Back button. A phone browser SHALL keep browser-history Back. Tab memory (tapping a tab returns to its last screen) is separate from Back, and no per-tab history stack SHALL be kept.

#### Scenario: Back from an account
- **GIVEN** the user opened Accounts from Settings and then an account
- **WHEN** the user taps Back
- **THEN** the accounts list shows and the Accounts tab stays selected

#### Scenario: Back from a category
- **GIVEN** the user opened a category on the Budget tab
- **WHEN** the user taps Back
- **THEN** the budget shows, on the Budget tab

#### Scenario: Tab memory is not Back
- **GIVEN** the user opened an account, switched to Reports, and tapped Accounts
- **WHEN** the same account shows and the user taps Back
- **THEN** the accounts list shows

#### Scenario: Back through Schedules
- **GIVEN** the user opened Schedules from Settings and then a schedule
- **WHEN** the user taps Back twice
- **THEN** Schedules shows, then Settings, with the Settings tab selected throughout

#### Scenario: A tab root has no Back
- **WHEN** the accounts list shows as the Accounts tab's root
- **THEN** there is no Back button

#### Scenario: Back after a deep link or relaunch
- **GIVEN** the app was opened by a deep link to an account, or restored there after a relaunch
- **WHEN** the user taps Back
- **THEN** the accounts list shows, and the app does not close or leave the tab

#### Scenario: Phone browser Back follows history
- **WHEN** the user taps Back on a screen in a phone browser
- **THEN** the browser goes to the previous page in its history

### Requirement: The iOS app runs one budget engine
The iOS app SHALL run exactly one budget engine (ADR 11). Every web screen, whichever tab shows it, SHALL come from one shared WebView, and native screens SHALL read and change budget data only through that engine's handlers. This requirement is iPhone-only; the Mac app runs one engine in Electron.

#### Scenario: Visiting every tab keeps one engine
- **GIVEN** the iOS app has just opened on the Budget tab
- **WHEN** the user visits Accounts, Reports and Settings, then returns to Budget
- **THEN** the app still has one WebView and one budget engine, and a transaction added on one tab shows on every other tab without a sync

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
