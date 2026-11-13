import Foundation
import XCTest

@testable import NativeBridgeCore

// native-bridge: "Sync is allowlisted as a call with no arguments", "Sync
// failure reasons map to a closed set" and "A sync call has its own 30 second
// deadline"; native-budget-screen: "Pulling down on the Budget tab syncs and
// re-reads the month" and its failure requirements (sc-3884). Fake transport,
// contract fixtures.
private let packagesDir = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()  // NativeBridgeCoreTests
    .deletingLastPathComponent()  // Tests
    .deletingLastPathComponent()  // NativeBridge
    .deletingLastPathComponent()  // ios
    .deletingLastPathComponent()  // mobile-client
    .deletingLastPathComponent()  // packages

private func fixtureJSON(_ name: String) throws -> String {
    String(decoding: try Data(contentsOf: packagesDir.appendingPathComponent(
        "loot-core/src/server/native/fixtures/\(name).json")), as: UTF8.self)
}

// The page's reduced sync results, written by nativeBridgeSync.test.ts
private func syncFixtures() throws -> [String: Any] {
    let data = try Data(contentsOf: packagesDir.appendingPathComponent("desktop-client/src/native/fixtures/sync-results.json"))
    return try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
}

private func syncFixture(_ key: String) throws -> String {
    let value = try XCTUnwrap(try syncFixtures()[key])
    return String(decoding: try JSONSerialization.data(withJSONObject: value, options: .sortedKeys), as: UTF8.self)
}

private var utc: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    return calendar
}

private let march9: () -> Date = { DateComponents(calendar: utc, year: 2026, month: 3, day: 9).date! }

private let server = "https://sync.example.com/sync/sync"

final class SyncAllowlistTests: XCTestCase {
    func testSyncIsAllowlistedAndThePageListMatches() throws {
        XCTAssertTrue(NativeBridgeAllowlist.handlers.contains("sync"))
        let page = try JSONDecoder().decode([String].self, from: Data(contentsOf: packagesDir.appendingPathComponent(
            "desktop-client/src/data/native-bridge-allowlist.json")))
        XCTAssertEqual(Set(page), NativeBridgeAllowlist.handlers)
    }

    // "Sync is the only handler outside reads and budget writes"
    func testEveryHandlerIsAReadAWriteOrSync() {
        XCTAssertEqual(NativeBridgeAllowlist.reads, ["native/budget-month", "query"])
        XCTAssertEqual(NativeBridgeAllowlist.writes, ["budget/budget-amount", "budget/transfer-category", "budget/transfer-available"])
        XCTAssertEqual(NativeBridgeAllowlist.sync, ["sync"])
        XCTAssertEqual(NativeBridgeAllowlist.handlers, NativeBridgeAllowlist.reads.union(NativeBridgeAllowlist.writes).union(NativeBridgeAllowlist.sync))
    }

    func testSyncSendsNoArguments() async throws {
        var seen: [(String, String)] = []
        let client = NativeBridgeClient { name, args in
            seen.append((name, args))
            return #"{"ok":true}"#
        }
        let result = try await client.sync()
        XCTAssertEqual(result, .ok)
        XCTAssertEqual(seen.map(\.0), ["sync"])
        XCTAssertEqual(seen.map(\.1), ["{}"])
    }

    func testTheGenericCallRefusesSyncInEveryShape() async {
        var calls = 0
        let client = NativeBridgeClient { _, _ in
            calls += 1
            return #"{"ok":true}"#
        }
        let attempts: [() async throws -> Data] = [
            { try await client.call("sync") },
            { try await client.call("sync", args: [String: String]()) },
            { try await client.call("sync", args: ["force": "true"]) },
            { try await client.call("sync", args: try BudgetAmountWrite(category: "rent", month: "2026-03", amount: 1)) },
        ]
        for attempt in attempts {
            do {
                _ = try await attempt()
                XCTFail("expected a refusal")
            } catch {
                XCTAssertEqual(error as? NativeBridgeError, .notAllowlisted("sync"))
            }
        }
        XCTAssertEqual(calls, 0)
    }

    func testBankSyncIsRefused() async {
        let client = NativeBridgeClient { _, _ in XCTFail("the page must not be called"); return "{}" }
        for name in ["simplefin-batch-sync", "accounts-bank-sync", "simplefin-accounts", "gocardless-accounts-sync"] {
            do {
                _ = try await client.call(name)
                XCTFail("expected a refusal for \(name)")
            } catch {
                XCTAssertEqual(error as? NativeBridgeError, .notAllowlisted(name))
            }
        }
    }
}

final class SyncResultTests: XCTestCase {
    private func decode(_ json: String) throws -> SyncResult {
        try JSONDecoder().decode(SyncResult.self, from: Data(json.utf8))
    }

    func testDecodesEveryContractFixture() throws {
        let expected: [String: SyncResult] = [
            "ok": .ok, "network": .failed(.network), "unauthorized": .failed(.unauthorized),
            "out-of-sync": .failed(.outOfSync), "clock-drift": .failed(.clockDrift),
            "encryption": .failed(.encryption), "other": .failed(.other),
        ]
        XCTAssertEqual(Set(try syncFixtures().keys), Set(expected.keys))
        for (key, result) in expected {
            XCTAssertEqual(try decode(syncFixture(key)), result, key)
        }
    }

    func testAnUnknownOrMissingReasonIsOther() throws {
        XCTAssertEqual(try decode(#"{"ok":false,"reason":"brand-new"}"#), .failed(.other))
        XCTAssertEqual(try decode(#"{"ok":false}"#), .failed(.other))
    }

    func testAChangedShapeFailsToDecode() {
        XCTAssertThrowsError(try decode(#"{"success":true}"#))
        XCTAssertThrowsError(try decode(#"{"ok":"yes"}"#))
    }

    func testAResultThatIsNotTheShapeIsABadResult() async {
        let client = NativeBridgeClient { _, _ in #"{"messages":[]}"# }
        do {
            _ = try await client.sync()
            XCTFail("expected a bad result")
        } catch {
            XCTAssertEqual(error as? NativeBridgeError, .badResult)
        }
    }
}

final class SyncDeadlineTests: XCTestCase {
    private func hanging(timeout: TimeInterval, syncTimeout: TimeInterval) -> NativeBridgeClient {
        NativeBridgeClient(timeout: timeout, syncTimeout: syncTimeout) { _, _ in
            await withCheckedContinuation { (_: CheckedContinuation<Void, Never>) in }
            return "{}"
        }
    }

    func testSyncWaitsThirtySecondsAndReadsKeepFive() {
        XCTAssertEqual(NativeBridgeClient.defaultSyncTimeout, 30)
        XCTAssertEqual(NativeBridgeClient.defaultTimeout, 5)
    }

    // The deadlines are injected, scaled down: sync gets its own, reads the default
    func testSyncUsesItsOwnDeadlineAndReadsTheDefault() async {
        let client = hanging(timeout: 0.05, syncTimeout: 0.4)
        var started = Date()
        do {
            _ = try await client.budgetMonth("2026-03")
            XCTFail("expected a timeout")
        } catch {
            XCTAssertEqual(error as? NativeBridgeError, .timedOut("native/budget-month"))
        }
        XCTAssertLessThan(Date().timeIntervalSince(started), 0.35)
        started = Date()
        do {
            _ = try await client.sync()
            XCTFail("expected a timeout")
        } catch {
            XCTAssertEqual(error as? NativeBridgeError, .timedOut("sync"))
        }
        XCTAssertGreaterThanOrEqual(Date().timeIntervalSince(started), 0.39)
    }

    func testASlowSyncWithinItsDeadlineIsNotATimeout() async throws {
        let client = NativeBridgeClient(timeout: 0.05, syncTimeout: 2) { _, _ in
            try await Task.sleep(nanoseconds: 200_000_000)
            return #"{"ok":true}"#
        }
        let result = try await client.sync()
        XCTAssertEqual(result, .ok)
    }
}

// 2.3: a sync call off the app's own page reaches no page
@MainActor
final class SyncPageCallTests: XCTestCase {
    func testASyncCallOnAForeignPageIsTheOriginErrorAndReachesNoPage() async {
        let ownServer = URL(string: "capacitor://localhost")!
        for url in ["https://tenant.auth0.com/authorize", "http://localhost/", "capacitor://localhost:8080/", "https://actual.example.com/", "about:blank"] {
            let page = FakePage(url)
            let client = NativeBridgeClient { name, args in try await PageCall(runner: page, serverURL: ownServer).bridgeCall(name: name, argsJSON: args) }
            do {
                _ = try await client.sync()
                XCTFail("expected the origin error for \(url)")
            } catch {
                XCTAssertEqual(error as? NativeBridgeError, .pageOrigin)
            }
            XCTAssertTrue(page.calls.isEmpty, url)
        }
    }

    // A subframe never reaches the page bridge (the inbound guard)
    func testASyncFromAnotherFrameHostSchemeOrPortIsRejected() {
        let server = URL(string: "https://app.example.com")!
        XCTAssertFalse(PageOriginGuard.accepts(isMainFrame: false, scheme: "https", host: "app.example.com", port: 0, serverURL: server))
        XCTAssertFalse(PageOriginGuard.accepts(isMainFrame: true, scheme: "https", host: "sync.example.com", port: 0, serverURL: server))
        XCTAssertFalse(PageOriginGuard.accepts(isMainFrame: true, scheme: "http", host: "app.example.com", port: 0, serverURL: server))
        XCTAssertFalse(PageOriginGuard.accepts(isMainFrame: true, scheme: "https", host: "app.example.com", port: 8443, serverURL: server))
    }

    func testTheAppsOwnPageGetsTheSyncName() async throws {
        let page = FakePage("capacitor://localhost/budget")
        page.reply = ["confirmed": true, "value": #"{"ok":true}"#]
        let client = NativeBridgeClient { name, args in
            try await PageCall(runner: page, serverURL: URL(string: "capacitor://localhost")).bridgeCall(name: name, argsJSON: args)
        }
        let result = try await client.sync()
        XCTAssertEqual(result, .ok)
        XCTAssertEqual(page.calls.first?.arguments["name"] as? String, "sync")
        XCTAssertEqual(page.calls.first?.arguments["args"] as? String, "{}")
    }
}

// 3.3: the event path reads only the name
final class NativeBridgeEventTests: XCTestCase {
    func testOnlyTheEventNameIsRead() {
        let body: [String: Any] = [
            "event": "sync-event",
            "payload": ["type": "error", "subtype": "invalid-schema", "meta": ["message": server, "stack": "at \(server)"]],
        ]
        let name = NativeBridgeEvent.name(of: body)
        XCTAssertEqual(name, "sync-event")
        XCTAssertFalse(String(reflecting: name).contains("sync.example.com"))
        XCTAssertNil(NativeBridgeEvent.name(of: ["payload": 1]))
        XCTAssertNil(NativeBridgeEvent.name(of: "sync-event"))
    }
}

private final class Gate {
    var continuation: CheckedContinuation<Void, Never>?
    func open() { continuation?.resume(); continuation = nil }
}

@MainActor
final class BudgetRefreshTests: XCTestCase {
    // A fake page: `sync` answers with `syncReply` (or hangs on `gate`), reads answer `month`
    private final class Page {
        var syncReply: () async throws -> String = { #"{"ok":true}"# }
        var month: () throws -> String
        var names: [String] = []
        init(month: String) { self.month = { month } }
    }

    private func model(_ page: Page, syncTimeout: TimeInterval = 1, changeInterval: TimeInterval = 1.0 / 60) -> BudgetViewModel {
        let client = NativeBridgeClient(timeout: 1, syncTimeout: syncTimeout) { name, _ in
            page.names.append(name)
            return name == "sync" ? try await page.syncReply() : try page.month()
        }
        return BudgetViewModel(client: client, now: march9, calendar: utc, changeInterval: changeInterval)
    }

    private func month(_ json: String) throws -> BudgetMonth {
        try JSONDecoder().decode(BudgetMonth.self, from: Data(json.utf8))
    }

    private func changed(_ json: String) -> String {
        json.replacingOccurrences(of: "140000", with: "130000")
    }

    func testOkReReadsOnceAndTheNewNumbersShow() async throws {
        let json = try fixtureJSON("budget-month-envelope")
        let page = Page(month: json)
        let model = model(page)
        await model.load()
        page.month = { self.changed(json) }
        await model.refresh()
        XCTAssertEqual(page.names, ["native/budget-month", "sync", "native/budget-month"])
        XCTAssertEqual(model.state, .loaded(try month(changed(json))))
        XCTAssertNil(model.refreshError)
    }

    func testATrackingBudgetRefreshesTheSameWay() async throws {
        let json = try fixtureJSON("budget-month-tracking")
        let page = Page(month: json)
        let model = model(page)
        await model.load()
        await model.refresh()
        XCTAssertEqual(page.names, ["native/budget-month", "sync", "native/budget-month"])
        XCTAssertEqual(model.state, .loaded(try month(json)))
    }

    // The numbers come from the read, never from the sync result
    func testNoTotalComesFromTheSyncResult() async throws {
        let json = try fixtureJSON("budget-month-envelope")
        let page = Page(month: json)
        page.syncReply = { #"{"ok":true,"totals":{"toBudget":1}}"# }
        let model = model(page)
        await model.load()
        await model.refresh()
        XCTAssertEqual(model.state, .loaded(try month(json)))
    }

    func testEachFailureReasonKeepsTheNumbersWithItsFixedMessage() async throws {
        let json = try fixtureJSON("budget-month-envelope")
        let cases: [(String, BudgetRefreshError, String)] = [
            ("network", .offline, "You're offline. Showing the last numbers."),
            ("unauthorized", .signedOut, "Sign in again to sync."),
            ("out-of-sync", .failed, "Couldn't sync. Try again."),
            ("clock-drift", .failed, "Couldn't sync. Try again."),
            ("encryption", .failed, "Couldn't sync. Try again."),
            ("other", .failed, "Couldn't sync. Try again."),
        ]
        for (key, error, message) in cases {
            let page = Page(month: json)
            let reply = try syncFixture(key)
            page.syncReply = { reply }
            let model = model(page)
            await model.load()
            await model.refresh()
            XCTAssertEqual(model.state, .stale(try month(json), .other), key)
            XCTAssertEqual(model.refreshError, error, key)
            XCTAssertEqual(model.refreshError?.message, message, key)
            // No re-read after a failed sync
            XCTAssertEqual(page.names, ["native/budget-month", "sync"], key)
        }
    }

    func testEveryOtherBridgeErrorShowsOnlyTheFixedMessage() async throws {
        let json = try fixtureJSON("budget-month-envelope")
        let errors: [Error] = [
            NativeBridgeError.page("fetch \(server) failed"), NativeBridgeError.pageOrigin, NativeBridgeError.noPage,
            NativeBridgeError.badResult,
            NSError(domain: "WKErrorDomain", code: 4, userInfo: ["WKJavaScriptExceptionMessage": server]),
        ]
        for error in errors {
            let page = Page(month: json)
            page.syncReply = { throw error }
            let model = model(page)
            await model.load()
            await model.refresh()
            XCTAssertEqual(model.refreshError, .failed)
            XCTAssertEqual(model.refreshError?.message, "Couldn't sync. Try again.")
            XCTAssertEqual(model.state, .stale(try month(json), .other))
            // The text is kept nowhere the model holds
            let held = "\(String(reflecting: model.state)) \(String(reflecting: model.refreshError)) \(String(reflecting: model.saveError))"
            XCTAssertFalse(held.contains("sync.example.com"), "\(error)")
        }
    }

    func testOkThenAFailedReReadKeepsTheNumbersWithRefreshFailed() async throws {
        let json = try fixtureJSON("budget-month-envelope")
        let page = Page(month: json)
        let model = model(page)
        await model.load()
        page.month = { throw NativeBridgeError.page("boom") }
        await model.refresh()
        guard case .stale(let shown, _) = model.state else { return XCTFail("expected stale, got \(model.state)") }
        XCTAssertEqual(shown, try month(json))
        XCTAssertEqual(model.refreshError, .refreshFailed)
        XCTAssertEqual(model.refreshError?.message, "Couldn't sync. Try again.")
    }

    func testATimeoutKeepsTheNumbersAndIsNotRetriedOrReRead() async throws {
        let json = try fixtureJSON("budget-month-envelope")
        let page = Page(month: json)
        let gate = Gate()
        page.syncReply = {
            await withCheckedContinuation { gate.continuation = $0 }
            return #"{"ok":true}"#
        }
        let model = model(page, syncTimeout: 0.05)
        await model.load()
        await model.refresh()
        XCTAssertEqual(model.refreshError, .timedOut)
        XCTAssertEqual(model.refreshError?.message, "Still syncing. The screen updates when it finishes.")
        XCTAssertEqual(model.state, .stale(try month(json), .timedOut))
        XCTAssertEqual(page.names, ["native/budget-month", "sync"])
        gate.open()
    }

    // The guard is held until the page call settles, not just until the deadline
    func testAPullAfterTheDeadlineWaitsForThePageCallToSettle() async throws {
        let json = try fixtureJSON("budget-month-envelope")
        let page = Page(month: json)
        let gate = Gate()
        page.syncReply = {
            await withCheckedContinuation { gate.continuation = $0 }
            return #"{"ok":true}"#
        }
        let model = model(page, syncTimeout: 0.05)
        await model.load()
        await model.refresh()
        XCTAssertEqual(model.refreshError, .timedOut)
        await model.refresh()
        XCTAssertEqual(page.names.filter { $0 == "sync" }.count, 1)
        page.syncReply = { #"{"ok":true}"# }
        gate.open()
        // The settle hops to the main actor
        for _ in 0..<50 where model.isSyncing { try await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertFalse(model.isSyncing)
        await model.refresh()
        XCTAssertEqual(page.names.filter { $0 == "sync" }.count, 2)
    }

    func testASecondPullWhileOneRunsMakesNoSecondCall() async throws {
        let json = try fixtureJSON("budget-month-envelope")
        let page = Page(month: json)
        let gate = Gate()
        page.syncReply = {
            await withCheckedContinuation { gate.continuation = $0 }
            return #"{"ok":true}"#
        }
        let model = model(page)
        await model.load()
        let first = Task { await model.refresh() }
        for _ in 0..<50 where gate.continuation == nil { try await Task.sleep(nanoseconds: 10_000_000) }
        await model.refresh()
        XCTAssertEqual(page.names.filter { $0 == "sync" }.count, 1)
        gate.open()
        await first.value
        XCTAssertEqual(page.names, ["native/budget-month", "sync", "native/budget-month"])
    }

    func testNothingRunsWhileTheSceneIsInactive() async throws {
        let page = Page(month: try fixtureJSON("budget-month-envelope"))
        let model = model(page)
        await model.load()
        await model.setSceneActive(false)
        await model.refresh()
        XCTAssertEqual(page.names, ["native/budget-month"])
        XCTAssertNil(model.refreshError)
    }

    func testOnlyTheServerSyncIsEverCalled() async throws {
        let page = Page(month: try fixtureJSON("budget-month-envelope"))
        let model = model(page)
        await model.load()
        await model.refresh()
        XCTAssertEqual(Set(page.names), ["native/budget-month", "sync"])
    }

    // 3.4: the late sync-event re-reads through the change-event path
    func testTheLateSyncEventAfterATimeoutReReads() async throws {
        let json = try fixtureJSON("budget-month-envelope")
        let page = Page(month: json)
        let gate = Gate()
        page.syncReply = {
            await withCheckedContinuation { gate.continuation = $0 }
            return #"{"ok":true}"#
        }
        let model = model(page, syncTimeout: 0.05, changeInterval: 0.01)
        await model.load()
        await model.refresh()
        XCTAssertEqual(model.refreshError, .timedOut)
        page.month = { self.changed(json) }
        gate.open()
        model.changeEventReceived()
        for _ in 0..<100 where model.state != .loaded(try month(changed(json))) { try await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertEqual(model.state, .loaded(try month(changed(json))))
        XCTAssertNil(model.refreshError)
        XCTAssertEqual(page.names.filter { $0 == "sync" }.count, 1)
    }

    // A failed sync sends its own sync-event before its result (offline-sync.test.ts
    // in loot-core); the re-read it causes must not clear the message or the dimming
    func testTheFailedSyncsOwnEventKeepsTheMessageAndTheDimming() async throws {
        let json = try fixtureJSON("budget-month-envelope")
        let page = Page(month: json)
        let model = model(page, changeInterval: 0.01)
        let reply = try syncFixture("network")
        page.syncReply = {
            await model.changeEventReceived()
            return reply
        }
        await model.load()
        await model.refresh()
        // The event's re-read lands after the failure
        for _ in 0..<100 where page.names.count < 3 { try await Task.sleep(nanoseconds: 10_000_000) }
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(page.names, ["native/budget-month", "sync", "native/budget-month"])
        XCTAssertEqual(model.refreshError, .offline)
        XCTAssertEqual(model.refreshError?.message, "You're offline. Showing the last numbers.")
        guard case .stale = model.state else { return XCTFail("expected stale, got \(model.state)") }
    }

    // A read that no change event caused clears a pull's failure (sc-4081)
    func testNonEventReadsClearTheFailure() async throws {
        let json = try fixtureJSON("budget-month-envelope")
        for how in ["load", "foreground", "pageReady", "pull", "month step"] {
            let page = Page(month: json)
            let model = model(page)
            let reply = try syncFixture("network")
            page.syncReply = { reply }
            await model.load()
            await model.refresh()
            XCTAssertEqual(model.refreshError, .offline, how)
            switch how {
            case "load": await model.load()
            case "foreground":
                await model.setSceneActive(false)
                await model.setSceneActive(true)
            case "pageReady": await model.pageReady()
            case "month step": await model.previous()
            default:
                page.syncReply = { #"{"ok":true}"# }
                await model.refresh()
            }
            XCTAssertNil(model.refreshError, how)
            guard case .loaded = model.state else { return XCTFail("\(how): expected loaded, got \(model.state)") }
        }
    }
}
