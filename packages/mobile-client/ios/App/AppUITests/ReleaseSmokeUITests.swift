import XCTest

// Fork-only (sc-5219, the iPhone guard flip). A smoke run of a RELEASE build of
// the app carrying a TEST page, run by hand, never in CI: each test skips unless
// the runner sets TEST_RUNNER_RELEASE_SMOKE to the page it staged:
//   failure / quota  a page built FORK_TEST_HOOKS with FORK_TEST_FAIL_STORAGE_AFTER_MS
//                    (and FORK_TEST_FAIL_STORAGE_QUOTA): the worker arms the
//                    storage failure by itself, so the app binary holds no hook
//   slow             a page built with a 3,000 ms commit delay
// The write is a real one through the native Reconcile flow ("Use cleared balance").
// TEST_RUNNER_RELEASE_SMOKE_RUN names the screenshot folder; TEST_RUNNER_RELEASE_SMOKE_LOOK
// is "light", "dark" or "ax5".
final class ReleaseSmokeUITests: XCTestCase {
    private let app = XCUIApplication()
    private var page: String { ProcessInfo.processInfo.environment["RELEASE_SMOKE"] ?? "" }
    private var run: String { ProcessInfo.processInfo.environment["RELEASE_SMOKE_RUN"] ?? "run" }
    private var look: String { ProcessInfo.processInfo.environment["RELEASE_SMOKE_LOOK"] ?? "light" }
    private var strip: XCUIElement { app.staticTexts["pageNotice.text"] }
    private var button: XCUIElement { app.buttons["pageNotice.dismiss"] }

    override func setUp() {
        continueAfterFailure = false
    }

    override func tearDown() {
        XCUIDevice.shared.appearance = .light
    }

    private func save(_ name: String) {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        let home = NSHomeDirectory().components(separatedBy: "/Library/Developer/CoreSimulator").first ?? NSHomeDirectory()
        let folder = URL(fileURLWithPath: "\(home)/Library/Developer/HomeEconomicsSpike/guard-flip-5219/release-\(run)")
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? shot.pngRepresentation.write(to: folder.appendingPathComponent("\(name)-\(look).png"))
    }

    // The demo budget, its Bank of America register, More, Reconcile
    private func openReconcile() {
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        if look == "ax5" { app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] }
        if look == "dark" { XCUIDevice.shared.appearance = .dark }
        app.launch()
        let accounts = app.tabBars.buttons["Accounts"]
        let demo = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Try the demo")).firstMatch
        let deadline = Date().addingTimeInterval(180)
        while !accounts.exists && !demo.exists && Date() < deadline { sleep(1) }
        if !accounts.exists { demo.tap() }
        XCTAssertTrue(accounts.waitForExistence(timeout: 120), "the demo budget did not open")
        accounts.tap()
        let row = NSPredicate(format: "label CONTAINS %@", "Bank of America")
        let account = app.buttons.matching(row).firstMatch
        _ = account.waitForExistence(timeout: 30)
        for _ in 0..<6 where !account.isHittable { app.swipeUp() }
        if account.exists { account.tap() } else { app.staticTexts.matching(row).firstMatch.tap() }
        XCTAssertTrue(app.buttons["More"].waitForExistence(timeout: 30), "the register did not open")
        app.buttons["More"].tap()
        app.buttons["Reconcile"].tap()
    }

    private var useCleared: XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Use cleared balance")).firstMatch
    }

    // The worker arms the failure FORK_TEST_FAIL_STORAGE_AFTER_MS after it starts:
    // the next write to storage fails for real, and the failure notice must show,
    // which it can only do with the guard on (the opt-in reached the page)
    private func checkFailure(saying text: String) throws {
        let launched = Date()
        openReconcile()
        // TEST_RUNNER_RELEASE_SMOKE_ARM_S: when the page arms itself, so the write comes after
        let armed = Double(ProcessInfo.processInfo.environment["RELEASE_SMOKE_ARM_S"] ?? "0") ?? 0
        let wait = armed + 3 - Date().timeIntervalSince(launched)
        if wait > 0 { Thread.sleep(forTimeInterval: wait) }
        if useCleared.waitForExistence(timeout: 30) { useCleared.tap() }
        XCTAssertTrue(strip.waitForExistence(timeout: 150), "no failure notice in a Release build")
        sleep(1)
        save("\(page)-notice")
        XCTAssertTrue(strip.label.hasPrefix(text), strip.label)
        XCTAssertEqual(button.label, "Reload the app")
    }

    func testAReleaseBuildShowsTheFailureNoticeWithReload() throws {
        try XCTSkipUnless(page == "failure", "needs the failure test page")
        try checkFailure(saying: "Changes can't be saved on this device right now. Reload the app.")
    }

    func testAReleaseBuildShowsTheDeviceFullNoticeWithReload() throws {
        try XCTSkipUnless(page == "quota", "needs the full-device test page")
        try checkFailure(saying: "This device is full, so changes can't be saved.")
    }

    // sc-5303's gating with the line off: a write slower than the storage wait
    // shows no "Saved" alert, because step 2 opens before storage confirms it
    func testAReleaseBuildShowsNoSavedBeforeStorageConfirms() throws {
        try XCTSkipUnless(page == "slow", "needs the slow test page")
        openReconcile()
        XCTAssertTrue(useCleared.waitForExistence(timeout: 30), "no Use cleared balance on step 1")
        useCleared.tap()
        let stepTwo = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Step 2 of 4")).firstMatch
        XCTAssertTrue(stepTwo.waitForExistence(timeout: 30), "step 2 never opened")
        save("slow-step-two")
        sleep(6)
        XCTAssertFalse(app.alerts.firstMatch.exists, "an alert claimed the change was saved before storage confirmed it")
        XCTAssertFalse(app.staticTexts["storage.line"].exists, "the storage line is off in Release")
        save("slow-step-two-later")
    }
}
