import XCTest

// Fork-only (sc-5219, the iPhone guard flip). A smoke run of a RELEASE build of
// the app carrying a TEST page, run by hand, never in CI: each test skips unless
// the runner sets TEST_RUNNER_RELEASE_SMOKE to the page it staged:
//   failure / quota  a page built FORK_TEST_HOOKS with FORK_TEST_FAIL_STORAGE_AFTER_MS
//                    (and FORK_TEST_FAIL_STORAGE_QUOTA): the worker arms the
//                    storage failure by itself, so the app binary holds no hook
//   slow             a page built with a 3,000 ms commit delay
// The failure write is a real one: a budgeted amount typed on the native Budget
// tab, which the guard evidence showed reaches storage; the slow check uses Reconcile.
// A Release build refuses a hooks page (fork/scripts/check-release-page.sh) unless the
// run passes the build setting FORK_RELEASE_SMOKE_TEST_PAGE=YES, honoured only for a
// simulator build that isn't an archive.
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

    // The demo budget open on its Accounts tab
    private func openDemo() {
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
    }

    // The demo budget, its Bank of America register, More, Reconcile
    private func openReconcile() {
        openDemo()
        app.tabBars.buttons["Accounts"].tap()
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

    private func evidence(_ text: String) { print("release smoke evidence: \(text)") }

    // The worker arms the failure FORK_TEST_FAIL_STORAGE_AFTER_MS after it starts:
    // the next write to storage fails for real, and the failure notice must show,
    // which it can only do with the guard on (the opt-in reached the page).
    // Says what it saw, so a write that never happened can't pass for a missing notice.
    private func checkFailure(saying text: String) throws {
        let launched = Date()
        openDemo()
        app.tabBars.buttons["Budget"].tap()
        // The native row, not the web page's own "Food" button under it
        let food = app.collectionViews.buttons["Food"].firstMatch
        XCTAssertTrue(food.waitForExistence(timeout: 60), "no Food row on the Budget tab")
        // TEST_RUNNER_RELEASE_SMOKE_ARM_S: when the page arms itself, so the write comes after.
        // Counted from the worker's start, which comes some seconds after launch
        let armed = Double(ProcessInfo.processInfo.environment["RELEASE_SMOKE_ARM_S"] ?? "0") ?? 0
        let wait = armed + 30 - Date().timeIntervalSince(launched)
        if wait > 0 { Thread.sleep(forTimeInterval: wait) }
        let before = food.value as? String ?? ""
        let field = app.textFields["Budgeted Food"]
        // The timer starts with the worker, and a worker that restarted (a reload, a new
        // WebContent process) arms later than launch + ARM_S: so edit again, a new amount
        // each time, until the notice shows or the latest arming is well past. Each edit is
        // a stored write unless armed, so the attempts say when the failure took effect.
        var shown = false
        var attempt = 0
        while !shown && Date().timeIntervalSince(launched) < armed + 180 {
            attempt += 1
            let amount = "\(122 + attempt)"
            evidence("edit \(attempt): \(amount) at \(Int(Date().timeIntervalSince(launched))) s after launch; the page arms \(Int(armed)) s after its worker starts")
            // The budgeted amount is the first column, under the name
            for dy in [0.75, 0.45] where !field.exists {
                food.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: dy)).tap()
                _ = field.waitForExistence(timeout: 5)
            }
            XCTAssertTrue(field.exists, "the budgeted amount's edit sheet did not open")
            field.tap()
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 20) + amount)
            app.navigationBars.buttons["Save"].tap()
            shown = strip.waitForExistence(timeout: 20)
            if !shown { evidence("edit \(attempt) stored with no notice; Food now: \(food.value as? String ?? "")") }
        }
        sleep(1)
        save("\(page)-notice")
        // What the write did: the notice names when unsaved changes began; the row shows the typed amount
        evidence("notice shown = \(shown)\(shown ? ": " + strip.label : ""); edit sheet still open = \(field.exists)")
        evidence("Food before: \(before); Food now: \(food.exists ? (food.value as? String ?? "") : "not visible")")
        XCTAssertTrue(shown, "no failure notice after a write that should have failed (see the evidence lines)")
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
