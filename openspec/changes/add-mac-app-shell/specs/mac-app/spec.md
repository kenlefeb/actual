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

### Requirement: The app's scheme serves only its bundled web build
The app's scheme SHALL serve only files inside the bundled web build. It decodes and standardizes the path, ignores query and fragment, and refuses a path that resolves outside the build folder or contains NUL or backslash. An extensionless path that is not a file SHALL get the app's `index.html`, so client routes such as `/openid-cb` load. A missing path with an extension SHALL get not found.

#### Scenario: The OpenID callback route
- **GIVEN** the provider redirects to `homeeconomics://localhost/openid-cb?token=...`
- **WHEN** the scheme handles the request
- **THEN** it serves the app's `index.html`, and the page completes sign-in

#### Scenario: Traversal attempts
- **GIVEN** a request for `/%2e%2e/Info.plist`, `/..%2f..%2fInfo.plist`, a double-encoded form, or a sibling folder such as `www2/`
- **WHEN** the scheme handles it
- **THEN** it refuses the request and serves nothing outside the build folder

#### Scenario: A missing asset
- **GIVEN** a request for `/missing.js`
- **WHEN** the scheme handles it
- **THEN** it answers not found, not `index.html`

### Requirement: A page whose process ended is reloaded, and the user is told
When WebKit ends the page's process, the app SHALL reload its own page, never the address the window last showed. Each automatic reload SHALL show a brief notice at the top of the window that the page restarted and a change made just before may need checking. The notice SHALL not take focus or block input, SHALL be announced to VoiceOver, and SHALL hide itself. After three automatic reloads within a minute the app SHALL stop and ask, with a Reload button.

#### Scenario: The page's process ends
- **GIVEN** the app is showing its page
- **WHEN** WebKit ends the page's process
- **THEN** the app reloads its own page and shows the notice, which VoiceOver announces and which hides itself after a few seconds

#### Scenario: The person keeps working
- **GIVEN** the notice is showing
- **WHEN** the person clicks or types in the page
- **THEN** the page gets the input, and the notice did not take focus

#### Scenario: The process keeps ending
- **GIVEN** the app reloaded its page three times within a minute
- **WHEN** the process ends again
- **THEN** the app does not reload, and asks with a Reload button; pressing Reload shows no notice

### Requirement: Sign-in URLs and tokens are never logged
The Mac app's native code SHALL NOT log, store or send a URL's query or fragment, including the OpenID return, which carries the sign-in token. The scheme handler and the navigation handler SHALL log at most the path of a refused request.

#### Scenario: The OpenID return
- **GIVEN** sign-in returns to `homeeconomics://localhost/openid-cb?token=...`
- **WHEN** the app handles the navigation and the request
- **THEN** no log line, crash report or stored value contains the token or the query

### Requirement: The web view is never weakened
The Mac app SHALL NOT use a private WebKit API, or enable file-URL access or universal access from file URLs, or drop COOP or COEP. It SHALL NOT run a script in the page while the main frame is off `homeeconomics://localhost`. If the web view lacks the shared memory the engine's fast mode needs, the only fallback is the page's direct Worker in its fallback mode, as on iPhone. In-frame navigation SHALL be allowed only to the app's scheme and to `https` on the sync server and provider hosts.

#### Scenario: A plain-http server
- **GIVEN** the person enters an `http://` sync server address
- **WHEN** the web view would navigate the main frame to it
- **THEN** the app refuses the in-frame navigation

#### Scenario: Another host
- **GIVEN** an `https` link on the app's own page to a host that is neither the sync server nor the provider
- **WHEN** the user clicks it
- **THEN** it opens in the default browser, not in the app's web view

#### Scenario: An http link
- **GIVEN** an `http` link to any host
- **WHEN** the user clicks it
- **THEN** the app refuses it, and nothing opens

### Requirement: Only links on the app's own page open in the browser
A link the user clicks SHALL open in the default browser only when the page showing it is the app's own page, at `homeeconomics://localhost`. A click on any other page, such as the sync server's or the sign-in provider's, to a host outside the app's list SHALL be cancelled: nothing opens, and no part of the address is logged.

#### Scenario: A link on the provider's page
- **GIVEN** the sign-in provider's page is showing in the app and offers a link to another sign-in service
- **WHEN** the user clicks it
- **THEN** the app cancels it, nothing opens in the browser, and no part of the address is logged

#### Scenario: A link on the app's own page
- **GIVEN** the app's own page shows an `https` link to a host outside the list
- **WHEN** the user clicks it
- **THEN** it opens in the default browser

### Requirement: In-frame sign-in hosts are a fixed list in this milestone
Until story 4984, the hosts allowed in-frame over `https` SHALL be a list fixed in the app's build: the fork's sync servers and their OpenID provider. A user whose server or sign-in provider is not listed, or whose provider sends them to another host, SHALL sign in only with a password. Choosing OpenID SHALL keep the app on its sign-in screen with a message that this sign-in isn't supported yet and to use a password, and hand nothing to the browser.

#### Scenario: A listed server
- **GIVEN** the person's server and its OpenID provider are on the app's list
- **WHEN** they sign in with OpenID
- **THEN** the provider's pages load in the app's window and sign-in completes

#### Scenario: A server that is not listed
- **GIVEN** the person's server or its OpenID provider is not on the app's list
- **WHEN** they choose OpenID sign-in
- **THEN** the app stays on its sign-in screen and says this server's sign-in isn't supported in the Mac app yet and to use a password, and no browser opens

#### Scenario: Password sign-in on a server that is not listed
- **GIVEN** the person's server is not on the app's list
- **WHEN** they sign in with their password
- **THEN** sign-in completes in the app

#### Scenario: A redirect carrying a sign-in token or code
- **GIVEN** the app's window is sent, by a redirect or by the page, to a host that is not on the list
- **WHEN** the address holds a token or code
- **THEN** the app refuses it, opens nothing outside the app, and logs no part of the address

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

### Requirement: Evicted storage is recovered by download, with a warning
The sync server SHALL stay the source of truth. Outside the web view, never in a log, the app SHALL remember only that a budget was open and which one (its cloud file id). When it remembers an open budget and the page, once the app has finished starting, says no budget is stored on this Mac, it SHALL warn once that this Mac's local data was cleared and unsynced changes may be lost, tell the user to sign in and download the budget again, then show sign-in. It SHALL NOT warn on a slow page.

#### Scenario: Data evicted after a budget was open
- **GIVEN** a budget was open, and the app's website data was removed while the app was not running
- **WHEN** the app launches
- **THEN** it warns that local data was cleared and unsynced changes may be lost, tells the user to sign in and download the budget again, then shows the web sign-in, and after sign-in the budget downloads again with the server's numbers

#### Scenario: The warning shows once
- **GIVEN** the app warned about cleared data and the user dismissed it
- **WHEN** the app launches again with storage still empty
- **THEN** no warning shows, only the web sign-in

#### Scenario: A budget that fails to open
- **GIVEN** a budget was open last time and is still stored on this Mac
- **WHEN** it fails to open at launch, for example after an app update
- **THEN** no storage-loss warning shows

#### Scenario: A slow start
- **GIVEN** a budget was open last time
- **WHEN** the page has not yet said whether a budget is there
- **THEN** no warning shows, however long it takes

#### Scenario: A first launch
- **GIVEN** no budget was ever open on this Mac
- **WHEN** the app launches with empty storage
- **THEN** the web onboarding shows with no warning

### Requirement: The Mac app runs beside the Electron app
The Mac app SHALL use the bundle identifier `app.homeeconomics.budget.mac`, distinct from the iOS and Electron apps' `app.homeeconomics.budget`, so it has its own sandbox container, and it SHALL never read or write the Electron app's data directory. Both apps SHALL run at the same time on one Mac, each syncing through the server, without either changing the other's local data.

#### Scenario: Both open
- **GIVEN** the Electron app and the Mac app open on the same synced budget
- **WHEN** the user changes a budgeted amount in one
- **THEN** after a sync the other shows the change, and neither app's local files were touched by the other

### Requirement: The page recognizes the Mac shell
The web page SHALL recognize the Mac app by its user agent. It SHALL then start its engine in a direct Worker in the page's existing fallback mode, as the iPhone app does, and SHALL NOT treat the Mac app as the Electron app, including where the shell picks the theme. Browsers and Electron SHALL keep their current behaviour.

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
