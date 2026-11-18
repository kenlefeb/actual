# Spec Delta

## Purpose

The native SwiftUI Mac app: how it hosts the one loot-core engine, opens budgets only by sync download, and runs beside the Electron app (ADR 11).

## ADDED Requirements

### Requirement: The Mac app hosts the one engine in a web view inside its window
The Mac app SHALL run loot-core only in a web view that loads the app's staged web build from its own scheme at `homeeconomics://localhost`, with persistent website data. That web view SHALL stay in the main window's view hierarchy while the app runs, never detached, so the engine is not throttled as a hidden page. The app SHALL NOT start a second engine.

#### Scenario: Launch
- **GIVEN** the Mac app is installed
- **WHEN** it launches
- **THEN** its main window holds the web view, the page loads from `homeeconomics://localhost`, and loot-core starts in it

#### Scenario: The native Budget window is showing
- **GIVEN** a budget is open and the native Budget view is on screen
- **WHEN** the user works in it
- **THEN** the engine's web view is still in the same window, under the native view

#### Scenario: Relaunch keeps the budget
- **GIVEN** a budget was downloaded and the app quit
- **WHEN** the app launches again
- **THEN** the budget opens from the web view's stored data without a new download

### Requirement: The engine survives a closed window, sleep and wake
Closing the main window SHALL hide it, without stopping the engine or discarding its web view. When the app becomes active again or the Mac wakes, the visible native views SHALL re-read through the bridge, and the app SHALL NOT read while it is inactive or the Mac is asleep. Every bridge call keeps the client timeout.

#### Scenario: Sleep and wake
- **GIVEN** the native Budget view open
- **WHEN** the Mac sleeps and wakes
- **THEN** the view re-reads its months once, and a change synced from another device meanwhile shows without a manual refresh

#### Scenario: Window closed and reopened
- **GIVEN** the main window is closed while the app keeps running
- **WHEN** the user reopens it from the Dock
- **THEN** the same engine and open budget are shown, and the visible view re-reads

### Requirement: Onboarding uses the web screens and budgets open only by sync download
Until native onboarding ships, the Mac app SHALL show the web screens in its window for the server URL, sign-in (password and OpenID), the budget list and the encryption password. A budget SHALL open only by downloading it from the sync server, like a new device. An end-to-end encrypted budget SHALL ask for its password before it opens.

#### Scenario: OpenID sign-in
- **GIVEN** a server whose only sign-in method is OpenID
- **WHEN** the user signs in with the provider in the app window
- **THEN** the provider returns to `homeeconomics://localhost/openid-cb`, the app's page completes sign-in, and the budget list shows

#### Scenario: Download an envelope and a tracking budget
- **GIVEN** a signed-in user with an envelope budget and a tracking budget on the server
- **WHEN** the user opens each one
- **THEN** it downloads and opens, and its numbers equal the web app's for the same budget

#### Scenario: Encrypted budget
- **GIVEN** an end-to-end encrypted budget on the server
- **WHEN** the user opens it in the Mac app
- **THEN** the app asks for the encryption password, and the budget opens only after the correct one

### Requirement: Swift never opens a budget file
Native Mac code SHALL NOT open, read or copy a budget database, including the Electron app's files. The fork check that bans database libraries and `.sqlite` paths SHALL cover the Mac app's sources.

#### Scenario: A Mac Swift file imports SQLite
- **GIVEN** a Swift source in `packages/mobile-client/macos/`
- **WHEN** it adds `import SQLite3` or names a `.sqlite` path
- **THEN** the fork check fails and names the file

### Requirement: Evicted storage is recovered by download
The sync server SHALL stay the source of truth. If WebKit has evicted the web view's data, the Mac app SHALL show the web onboarding again, so the user signs in, downloads the budget and re-enters an encryption password. It SHALL NOT show stale numbers or fail silently.

#### Scenario: Data evicted
- **GIVEN** the app's website data was removed while the app was not running
- **WHEN** the app launches
- **THEN** the web onboarding shows, and after sign-in the budget downloads again with the server's numbers

### Requirement: The Mac app runs beside the Electron app
The Mac app SHALL use the bundle identifier `app.homeeconomics.budget.mac`, distinct from the iOS and Electron apps' `app.homeeconomics.budget`, so it has its own sandbox container, and and SHALL never read or write the Electron app's data directory. Both apps SHALL run at the same time on one Mac, each syncing through the server, without either changing the other's local data.

#### Scenario: Both open
- **GIVEN** the Electron app and the Mac app open on the same synced budget
- **WHEN** the user changes a budgeted amount in one
- **THEN** after a sync the other shows the change, and neither app's local files were touched by the other

### Requirement: The page recognizes the Mac shell
The web page SHALL recognize the Mac app by its user agent. It SHALL then start its engine in a direct Worker, as on iOS and Android, and SHALL NOT treat the Mac app as the Electron app. Browsers and Electron SHALL keep their current behaviour.

#### Scenario: Page in the Mac app
- **GIVEN** the page loaded in the Mac app's web view
- **WHEN** it starts the engine
- **THEN** it uses a direct Worker, and shell detection reports the Mac app, not Electron

#### Scenario: Page in a browser on a Mac
- **GIVEN** the page in Safari or Chrome on a Mac
- **WHEN** it starts the engine
- **THEN** behaviour is unchanged from today

### Requirement: The Mac app builds and tests in Fork CI
A pull request that touches the Mac app or `NativeBridgeCore` SHALL run a Fork CI job that builds the Mac app unsigned and runs its unit tests on a macOS runner. A failing build or test SHALL fail the check. The job SHALL NOT need signing secrets.

#### Scenario: A PR changes the Mac app
- **GIVEN** a PR that edits a file under `packages/mobile-client/macos/`
- **WHEN** Fork CI runs
- **THEN** the `fork-mac-native` job builds and tests the app, without signing secrets
