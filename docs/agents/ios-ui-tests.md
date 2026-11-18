# iPhone UI tests (XCUITest)

Fork-only (sc-5177). The iPhone app project has a UI-test target, `AppUITests`,
that drives a native screen on the simulator. Fork CI runs it in the
`Fork iOS simulator` job on any PR that touches `packages/mobile-client/ios/**`,
`packages/desktop-client/src/native/**` or the job itself.

## How a test gets data

A UI test launches the app with `-UITestAccounts YES`. In a Debug build,
`SceneDelegate` then makes the native Accounts screen the window's root, over a
fake `NativeBridgeClient` that answers from fixtures
(`App/App/UITestAccounts.swift`). There is no web view, budget, sign-in or
network. The code is inside `#if DEBUG`, so a Release build has neither the
host nor the launch argument. The fixtures are copies of
`packages/loot-core/src/server/native/fixtures/`; when a fixture's shape
changes, refresh the copy.

## Run them

```bash
yarn build:browser --skip-translations
LANG=en_US.UTF-8 yarn workspace mobile-client sync:ios   # pods need a UTF-8 locale
cd packages/mobile-client
xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 17' CODE_SIGNING_ALLOWED=NO test
```

Run one build at a time on the shared Mac, and check `uptime` first.

## Add a test to a native screen

1. A host's types and launch argument must be named `UITest<Screen>`, and every
   line that names one must sit inside `#if DEBUG` (`yarn check:native-swift`
   fails otherwise; the Release archive is also scanned for `UITest*` names in
   `fork-ios.yml`). If the screen is not the Accounts screen, add a host beside
   `UITestAccounts` (same `#if DEBUG`, its own launch argument, a fake client
   with the fixtures that screen reads) and one line in `SceneDelegate`.
2. Add a `final class ...UITests: XCTestCase` in `App/AppUITests/` and put the
   file in the `AppUITests` target (its Sources phase in `project.pbxproj`).
   `yarn check:native-swift` and the pbxproj source lists need no change for
   App-target files, but a new NativeBridgeCore source must still be in the App
   target's Sources phase.
3. Query by what a person (or VoiceOver) sees: `app.buttons["Edit"]`,
   `app.staticTexts["Checking"]`. A control with no label is a test finding as
   much as a bug: fix its `accessibilityLabel` rather than querying by position.
   Add `.accessibilityIdentifier(...)` only where the visible label is not
   unique or changes with the data.
4. Wait with `waitForExistence(timeout:)` or an `expectation(for:evaluatedWith:)`
   on an `exists == false` predicate. Never sleep.
5. Name the defect or requirement a test would have caught in a comment.

### Hardware keyboard and VoiceOver checks

- Keyboard: tap a field, then `app.typeText("...")` and
  `app.typeKey(.tab, modifierFlags: [])`; the simulator's "Connect Hardware
  Keyboard" setting decides whether the software keyboard shows. (Not yet
  exercised by a test in this target.)
- VoiceOver labels: XCUITest reads the accessibility tree, so `element.label`,
  `element.value` and `element.accessibilityHint` are what VoiceOver speaks.
  Assert them with `XCTAssertEqual(row.label, "...")`
  (`NativeAccountsAccessibilityUITests`). The iOS Simulator does not run
  VoiceOver, so nothing is ever "heard": a test checks what VoiceOver would be
  given, and a person with VoiceOver on a device checks how it sounds.
- What XCUITest cannot see, the Debug UI-test host reads from the live
  accessibility tree (`UITestActionsProbe` in `UITestAccounts.swift`): the custom
  actions (the actions rotor) of each row, and the elements VoiceOver can land on
  (XCUITest's own tree also lists accessibility-hidden elements and the parts
  inside a combined element, which VoiceOver does not stop on, so it cannot show
  what is hidden). Tap `uitest.dumpActions` or `uitest.dumpElements` and read
  `uitest.actions` or `uitest.elements`.
- Announcements: screens speak through `AccessibilityAnnouncer`; the host
  records what it was asked to say in `uitest.announcements` ("<how many>|<the
  last>"). `-UITestFailList YES` and `-UITestFailRegister YES` make a read fail;
  `-UITestSlowList YES` and `-UITestSlowRegister YES` hold it in flight.
- `performAccessibilityAudit(for:)` (iOS 17+) runs over the screen. Test the audit
  types about what VoiceOver finds and says; contrast, Dynamic Type and the
  system search field are reported separately.
- Dynamic Type: launch with
  `app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]`
  and assert key controls are still hittable (`isHittable`).

## Reading a failure

The CI job uploads the `.xcresult` bundle as the `ui-tests-xcresult` artifact
on a failure (7 days). Open it in Xcode for the failure screenshot and the view
hierarchy.
