import XCTest

// Fork-only (sc-5219, "Only stored changes reach the server"). Run by hand with
// fork/scripts/sync-gate-run.sh, never in CI: skips unless the runner sets
// TEST_RUNNER_SYNC_GATE_URL (a sync server on this Mac, bound to localhost) and
// TEST_RUNNER_SYNC_GATE_PASSWORD (that server's throwaway password). The staged
// page delays every storage commit by 3 s, longer than the 2 s storage wait, so a
// sync after a change must hold ("Waiting for this device to finish saving") and
// send nothing until storage confirms. The runner counts the server's messages.
final class SyncGateUITests: XCTestCase {
    private let app = XCUIApplication()
    private var env: [String: String] { ProcessInfo.processInfo.environment }

    override func setUp() {
        continueAfterFailure = false
    }

    // Wall-clock times, to set beside the server's message times
    private func evidence(_ text: String) {
        print("sync gate evidence: \(ISO8601DateFormatter.string(from: Date(), timeZone: .current, formatOptions: [.withInternetDateTime, .withFractionalSeconds])) \(text)")
    }

    private func anything(_ label: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", label)).firstMatch
    }

    func testASyncAfterAChangeHoldsUntilStorageConfirms() throws {
        let url = try XCTUnwrap(env["SYNC_GATE_URL"].flatMap { $0.isEmpty ? nil : $0 }, "needs TEST_RUNNER_SYNC_GATE_URL")
        let password = try XCTUnwrap(env["SYNC_GATE_PASSWORD"], "needs TEST_RUNNER_SYNC_GATE_PASSWORD")
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()

        // The welcome screen: connect to the server on this Mac
        let connect = anything("Connect to a sync server")
        XCTAssertTrue(connect.waitForExistence(timeout: 180), "no welcome screen")
        connect.tap()
        let external = anything("Use an external server")
        if external.waitForExistence(timeout: 10) { external.tap() }
        let field = app.textFields.matching(NSPredicate(format: "placeholderValue == %@", "https://example.com")).firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 30), "no server URL field")
        field.tap()
        field.typeText(url)
        app.buttons["Connect"].firstMatch.tap()

        // Sign in with the throwaway password
        let secret = app.secureTextFields.firstMatch
        XCTAssertTrue(secret.waitForExistence(timeout: 60), "no password field")
        secret.tap()
        secret.typeText(password)
        app.buttons["Sign in"].firstMatch.tap()

        // A new budget on that server: with no files yet the welcome screen offers "Start budgeting"
        let start = app.buttons["Start budgeting"].firstMatch
        let create = anything("Create new file")
        let deadline = Date().addingTimeInterval(60)
        while !start.exists && !create.exists && Date() < deadline { sleep(1) }
        XCTAssertTrue(start.exists || create.exists, "neither Start budgeting nor Create new file")
        (start.exists ? start : create).tap()
        let budgetTab = app.tabBars.buttons["Budget"]
        XCTAssertTrue(budgetTab.waitForExistence(timeout: 120), "the new budget did not open")
        evidence("budget open")
        // The new budget's own writes, at 3 s a commit, are a backlog: wait for the
        // first Synced (TEST_RUNNER_SYNC_GATE_SETTLE_S, default 600 s) before the change
        // under test. A backlog drains and syncs; a writer that never stops does not.
        app.tabBars.buttons["Accounts"].tap()
        let settle = Double(env["SYNC_GATE_SETTLE_S"] ?? "") ?? 600
        let settled = anything("Synced").waitForExistence(timeout: settle)
        evidence("first Synced after the budget opened: \(settled ? "yes" : "no, after \(Int(settle)) s")")
        XCTAssertTrue(settled, "the new budget's own sync never completed")

        budgetTab.tap()
        let food = app.collectionViews.buttons["Food"].firstMatch
        XCTAssertTrue(food.waitForExistence(timeout: 60), "no Food row on the Budget tab")
        let amount = app.textFields["Budgeted Food"]
        for dy in [0.75, 0.45] where !amount.exists {
            food.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: dy)).tap()
            _ = amount.waitForExistence(timeout: 5)
        }
        XCTAssertTrue(amount.exists, "the budgeted amount's edit sheet did not open")
        amount.tap()
        amount.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 20) + "321")
        app.navigationBars.buttons["Save"].tap()
        evidence("change saved in the app (Food 321)")

        // The Accounts tab's sync status and the storage line, each change of them, for
        // 150 s or until Synced has held for 10 s: a line that never clears means writes
        // keep coming, a clear line with the sync still held means the retry doesn't follow
        app.tabBars.buttons["Accounts"].tap()
        let statuses = ["Waiting for this device to finish saving", "Synced", "Syncing", "Sync failed", "Offline"]
        let line = app.staticTexts["storage.line"]
        var last = ""
        var lastLine = ""
        var sawWaiting = false
        var syncedAt: Date?
        let end = Date().addingTimeInterval(Double(env["SYNC_GATE_WATCH_S"] ?? "") ?? 150)
        while Date() < end {
            let now = statuses.first { anything($0).exists } ?? "none"
            let nowLine = line.exists ? line.label : "none"
            if now != last || nowLine != lastLine {
                evidence("status: \(now); storage line: \(nowLine)")
                (last, lastLine) = (now, nowLine)
                if now.hasPrefix("Waiting") { sawWaiting = true }
                syncedAt = now == "Synced" ? (syncedAt ?? Date()) : nil
            }
            if let syncedAt, Date().timeIntervalSince(syncedAt) > 10 { break }
            usleep(300_000)
        }
        XCTAssertTrue(sawWaiting, "the sync never held for storage")
        XCTAssertEqual(last, "Synced", "the held sync never completed")
    }
}
