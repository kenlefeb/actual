import XCTest

// Fork-only (sc-5219, the iPhone guard flip). The end-to-end evidence for the
// PR, run by hand against a test build of the page, not in CI: each test skips
// unless the runner sets TEST_RUNNER_GUARD_EVIDENCE to the page it staged
// ("plain", a FORK_TEST_HOOKS build; "slow", one with a commit delay longer than
// the storage wait; "stranded", the kept simulator with a stranded budget).
// TEST_RUNNER_GUARD_EVIDENCE_RUN names the folder the screenshots go in.
// `-UITestGuard` (UITestGuardEvidence.swift) drives the writes.
final class GuardEvidenceUITests: XCTestCase {
    private let app = XCUIApplication()
    private var page: String { ProcessInfo.processInfo.environment["GUARD_EVIDENCE"] ?? "" }
    private var run: String { ProcessInfo.processInfo.environment["GUARD_EVIDENCE_RUN"] ?? "run" }

    override func setUp() {
        continueAfterFailure = false
    }

    private func needs(_ kind: String) throws {
        try XCTSkipUnless(page == kind, "needs the \(kind) evidence page (TEST_RUNNER_GUARD_EVIDENCE)")
    }

    private func launch(_ mode: String?) {
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        if let mode { app.launchArguments += ["-UITestGuard", mode] }
        app.launch()
    }

    private var notes: XCUIElement { app.staticTexts["uiTestGuard"] }
    private var strip: XCUIElement { app.staticTexts["pageNotice.text"] }
    private var button: XCUIElement { app.buttons["pageNotice.dismiss"] }

    private func waitForNote(_ text: String, timeout: TimeInterval = 180) -> Bool {
        let found = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", text), object: notes)
        return XCTWaiter.wait(for: [found], timeout: timeout) == .completed
    }

    // Kept with the result and, on the Mac that runs it, in the evidence folder
    private func save(_ name: String) {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        let home = NSHomeDirectory().components(separatedBy: "/Library/Developer/CoreSimulator").first ?? NSHomeDirectory()
        let folder = URL(fileURLWithPath: "\(home)/Library/Developer/HomeEconomicsSpike/guard-flip-5219/\(run)")
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? shot.pngRepresentation.write(to: folder.appendingPathComponent("\(name).png"))
        print("guard evidence \(name):\n\(notes.exists ? notes.label : "no notes")")
    }

    func testANormalWriteIsAnsweredStored() throws {
        try needs("plain")
        launch("normal")
        XCTAssertTrue(waitForNote("done"), "the run never finished")
        save("normal-write")
        XCTAssertTrue(notes.label.contains("shell opted in = true"), notes.label)
        XCTAssertTrue(notes.label.contains("answered stored=true"), notes.label)
        XCTAssertFalse(strip.exists, "no notice for a write that stored")
    }

    func testASlowWriteIsNotAnsweredStoredUntilItIs() throws {
        try needs("slow")
        launch("slow")
        XCTAssertTrue(waitForNote("answered stored="), "no answer")
        save("slow-write-answer")
        XCTAssertTrue(notes.label.contains("answered stored=false"), notes.label)
        XCTAssertTrue(waitForNote("done"))
        save("slow-write-later")
        XCTAssertFalse(strip.exists, "a write that stores late raises no notice")
    }

    private func checkFailure(_ mode: String, saying text: String) throws {
        try needs("plain")
        launch(mode)
        XCTAssertTrue(waitForNote("waiting for Reload"), "the failure run never reached Reload")
        XCTAssertTrue(strip.waitForExistence(timeout: 20), "no failure notice")
        save("\(mode)-notice")
        XCTAssertTrue(strip.label.hasPrefix(text), strip.label)
        // Its VoiceOver label; the button reads "Reload"
        XCTAssertEqual(button.label, "Reload the app")
        XCTAssertTrue(notes.label.contains("storage failure armed"), notes.label)
        XCTAssertTrue(notes.label.contains(#""failed":true"#), notes.label)
        XCTAssertTrue(notes.label.contains("second write: refused"), notes.label)
        button.tap()
        XCTAssertTrue(waitForNote("after Reload: write:"), "no write after Reload")
        save("\(mode)-after-reload")
        XCTAssertTrue(notes.label.contains("after Reload: write: answered stored=true"), notes.label)
        // "The person reloads": the notice closes and no restart notice shows
        XCTAssertFalse(strip.exists, "a notice after the person's Reload: \(strip.exists ? strip.label : "")")
    }

    func testAStorageFailureRaisesTheNoticeWithReload() throws {
        try checkFailure("fail", saying: "Changes can't be saved on this device right now. Reload the app.")
    }

    func testAFullDeviceRaisesItsNoticeWithReload() throws {
        try checkFailure("quota", saying: "This device is full, so changes can't be saved.")
    }

    func testARestartWithAnUnconfirmedWriteRaisesTheRestartNotice() throws {
        try needs("slow")
        launch("restart")
        XCTAssertTrue(waitForNote("the page's process ends"))
        XCTAssertTrue(strip.waitForExistence(timeout: 60), "no restart notice")
        save("restart-notice")
        XCTAssertTrue(strip.label.hasPrefix("The app restarted."), strip.label)
        // Its VoiceOver label; the button reads "OK"
        XCTAssertEqual(button.label, "OK, close this notice")
        button.tap()
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: strip)
        XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 5), .completed, "OK left the notice up")
        save("restart-after-ok")
    }

    // A kept simulator whose budget was stranded mid-migration before PR #502.
    // Either #502's account-type repair lets it open (the tab bar shows), or the
    // failed open shows a dialog the person can answer. Says which it saw.
    func testAStrandedBudgetOpensOrShowsADialogThatCanBeAnswered() throws {
        try needs("stranded")
        launch(nil)
        let alert = app.alerts.firstMatch
        let budgetTab = app.tabBars.buttons["Budget"]
        var waited = 0
        while !alert.exists && !(budgetTab.exists && budgetTab.isHittable) && waited < 180 {
            sleep(1)
            waited += 1
        }
        if alert.exists {
            print("guard evidence stranded: the open failed and showed a dialog after \(waited) s")
            save("stranded-dialog")
            alert.buttons["OK"].tap()
            let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: alert)
            XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 10), .completed, "OK did not answer the dialog")
            sleep(3)
            save("stranded-after-ok")
        } else {
            XCTAssertTrue(budgetTab.exists, "neither a dialog nor the open budget in 180 s")
            print("guard evidence stranded: the budget opened after \(waited) s")
            sleep(3)
            save("stranded-opened")
        }
    }
}
