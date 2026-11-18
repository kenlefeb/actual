import Foundation
import NativeBridgeCore
import XCTest

@testable import HomeEconomicsMac

// Story 5186, a manual check, not a CI test: it ends real WebKit processes.
// It runs only with HE_PAGE_KILL_TEST=1, a staged www, and as a user with no
// other web pages open (the Atlas helper), because it ends every WebContent
// process of the current user that started after this app did (WebKit may
// hand the page a process it started in advance).
// It writes a budget amount through the bridge, waits HE_PAGE_KILL_DELAY
// seconds (default 0), ends the page's process, and checks that the
// reloaded page still has the amount. Run it (Debug build with www staged):
//   xcodebuild build-for-testing ... -derivedDataPath /Users/Shared/<dir>
//   atlas run -- /usr/bin/env TEST_RUNNER_HE_PAGE_KILL_TEST=1 \
//     TEST_RUNNER_HE_PAGE_KILL_DELAY=1 xcodebuild test-without-building \
//     -xctestrun <dir>/Build/Products/<name>.xctestrun -destination platform=macOS \
//     -only-testing:HomeEconomicsMacTests/PageProcessKillTests
// Measured 2026-11-18 (story 5186): 1 s and 5 s pass; 0 s fails, because
// loot-core writes to IndexedDB asynchronously and the latest changes were lost.
@MainActor
final class PageProcessKillTests: XCTestCase {
    private let marker = 4242

    func testAChangeSurvivesTheEndOfThePageProcess() async throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["HE_PAGE_KILL_TEST"] == "1", "manual check")
        // It ends this user's web processes: never in a person's own session
        try XCTSkipUnless(NSUserName() == "atlas", "runs only as the Atlas helper user")
        let www = Bundle.main.resourceURL!.appendingPathComponent("www")
        try XCTSkipUnless(FileManager.default.fileExists(atPath: www.appendingPathComponent("index.html").path), "no staged www")

        let host = MacEngineHost(www: www, version: "kill-test")
        var gaveUp = 0
        host.onPageGone = { gaveUp += 1 }
        host.load()
        let page = PageCall(runner: host.webView, serverURL: MacEngineHost.serverURL)
        try await waitFor("the page bridge") { (try? await page.run("return typeof window.__actualNativeBridge")) as? String == "object" }

        // A local test budget, created through the page's own connection
        _ = try await page.run("await window.$send('create-budget', { testMode: true }); return 'ok';")
        let month = NativeBridgeBenchmark.currentMonth()
        var snapshot: BudgetMonth?
        try await waitFor("the budget") {
            snapshot = try? await host.client.budgetMonth(month)
            return snapshot != nil
        }
        let category = try XCTUnwrap(snapshot?.expenseGroups.first?.categories.first)
        try await host.client.setBudgetAmount(BudgetAmountWrite(category: category.id, month: month, amount: marker))
        let written = try await budgeted(host, month, category.id)
        XCTAssertEqual(written, marker)
        let prefsId = try await page.run("return (await window.$send('load-prefs')).id;")
        let budgetId = try XCTUnwrap(prefsId as? String)

        // End the page's process; the host reloads the app's page
        // Seconds between the write and the kill (0: the write has only just returned)
        let delay = Double(ProcessInfo.processInfo.environment["HE_PAGE_KILL_DELAY"] ?? "0") ?? 0
        try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
        print("page kill test: ending the page \(delay) s after the write")
        let killed = try endWebContentProcesses()
        print("page kill test: ended \(killed)")
        XCTAssertFalse(killed.isEmpty)
        try await waitFor("the reloaded page's bridge") {
            (try? await page.run("return typeof window.__actualNativeBridge")) as? String == "object"
        }
        // Whether the reloaded page reopened the budget on its own
        var reopened = false
        let deadline = Date().addingTimeInterval(20)
        while Date() < deadline {
            if (try? await host.client.budgetMonth(month)) != nil { reopened = true; break }
            try await Task.sleep(nanoseconds: 500_000_000)
        }
        print("page kill test: reloaded page reopened the budget on its own: \(reopened)")
        let reopenedId = try await page.run("return (await window.$send('load-prefs'))?.id ?? null;") as? String
        print("page kill test: reopened budget is the test budget: \(reopenedId == budgetId)")
        if reopenedId != budgetId {
            _ = try await page.run(
                "await window.$send('load-budget', { id: budgetId }); return 'ok';", arguments: ["budgetId": budgetId])
        }
        let reread = try await host.client.budgetMonth(month)
        let found = reread.groups.flatMap(\.categories).first { $0.id == category.id }
        print("page kill test: category still there: \(found != nil)")
        let after = found?.budgeted
        print("page kill test: budgeted after the reload: \(String(describing: after))")
        XCTAssertEqual(after, marker)
        XCTAssertEqual(gaveUp, 0)
    }

    private func budgeted(_ host: MacEngineHost, _ month: String, _ id: String) async throws -> Int? {
        let snapshot = try await host.client.budgetMonth(month)
        return snapshot.groups.flatMap(\.categories).first { $0.id == id }?.budgeted
    }

    private func waitFor(_ what: String, timeout: TimeInterval = 60, _ check: () async throws -> Bool) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if try await check() { return }
            try await Task.sleep(nanoseconds: 500_000_000)
        }
        XCTFail("timed out waiting for \(what)")
        throw CancellationError()
    }

    // WebContent processes of this user that started after this app did
    private func endWebContentProcesses() throws -> [Int32] {
        let ps = Process()
        ps.executableURL = URL(fileURLWithPath: "/bin/ps")
        ps.arguments = ["-U", NSUserName(), "-o", "pid=,etime=,comm="]
        let pipe = Pipe()
        ps.standardOutput = pipe
        try ps.run()
        ps.waitUntilExit()
        let output = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        var appAge: TimeInterval = 0
        for line in output.split(separator: "\n") {
            let parts = line.split(separator: " ", maxSplits: 2, omittingEmptySubsequences: true)
            if parts.count == 3, Int32(parts[0]) == getpid() { appAge = Self.seconds(String(parts[1])) }
        }
        let age = appAge + 1
        var killed: [Int32] = []
        for line in output.split(separator: "\n") {
            let parts = line.split(separator: " ", maxSplits: 2, omittingEmptySubsequences: true)
            guard parts.count == 3, parts[2].hasSuffix("com.apple.WebKit.WebContent"), let pid = Int32(parts[0]),
                Self.seconds(String(parts[1])) < age
            else { continue }
            kill(pid, SIGKILL)
            killed.append(pid)
        }
        return killed
    }

    // ps etime: [[dd-]hh:]mm:ss
    private static func seconds(_ etime: String) -> TimeInterval {
        let dayParts = etime.split(separator: "-")
        let days = dayParts.count == 2 ? Double(dayParts[0]) ?? 0 : 0
        let clock = (dayParts.last ?? "").split(separator: ":").compactMap { Double($0) }
        return days * 86_400 + clock.reduce(0) { $0 * 60 + $1 }
    }
}
