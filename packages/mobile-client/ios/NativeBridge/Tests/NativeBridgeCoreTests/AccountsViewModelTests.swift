import Foundation
import XCTest

@testable import NativeBridgeCore

// sc-4931 (native-accounts-screen D6): the list's and the register's view
// models against a fake page transport and the loot-core contract fixtures.
// Swift holds no balance or order of its own: it reads, pages and re-reads.
private let fixturesDir = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("loot-core/src/server/native/fixtures")

private func fixture(_ name: String) throws -> String {
    String(decoding: try Data(contentsOf: fixturesDir.appendingPathComponent("\(name).json")), as: UTF8.self)
}

// The register fixture with its rows replaced: `ids` become rows (copies of the first row)
private func registerPage(ids: [String], next: String?, header: Bool) throws -> String {
    var object = try JSONSerialization.jsonObject(with: Data(try fixture("account-register").utf8)) as! [String: Any]
    let template = (object["rows"] as! [[String: Any]])[0]
    object["rows"] = ids.map { id -> [String: Any] in
        var row = template
        row["id"] = id
        return row
    }
    object["nextCursor"] = next ?? NSNull()
    if !header {
        object["header"] = nil
        object["upcoming"] = nil
    }
    return String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
}

private struct Boom: Error {}

// Time under the test's control: the models take their change timer and their
// typing pause from here, so no test waits on the wall clock. The models call
// these closures from tasks, so the state sits behind a lock, and a pause is
// counted only once its continuation is stored (sc-5055): a test that sees
// `pauses == n` can always end all n of them.
private final class ManualClock: @unchecked Sendable {
    private let lock = NSLock()
    private func locked<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }

    // Change coalescing: one timer per burst
    private var scheduledCount = 0
    private var changeTimers: [() -> Void] = []
    var scheduled: Int { locked { scheduledCount } }
    var schedule: ChangeSchedule {
        { [self] _, work in
            locked {
                scheduledCount += 1
                changeTimers.append(work)
            }
        }
    }

    func fireChanges() {
        let timers = locked { () -> [() -> Void] in
            defer { changeTimers = [] }
            return changeTimers
        }
        timers.forEach { $0() }
    }

    // The search pause: every pause waits here until the test ends it
    private var pauseCount = 0
    private var waiting: [CheckedContinuation<Void, Never>] = []
    var pauses: Int { locked { pauseCount } }
    var sleep: AccountsSleep {
        { [self] _ in
            await withCheckedContinuation { continuation in
                locked {
                    waiting.append(continuation)
                    pauseCount += 1
                }
            }
        }
    }

    func endPauses() {
        let all = locked { () -> [CheckedContinuation<Void, Never>] in
            defer { waiting = [] }
            return waiting
        }
        all.forEach { $0.resume() }
    }
}

// A read by position that fails the test cleanly when it never happened
private func read(_ requests: [[String: Any]], at index: Int) throws -> [String: Any] {
    try XCTUnwrap(requests.indices.contains(index) ? requests[index] : nil, "read number \(index) never happened")
}

// Waits for what a started task will do, as soon as it has done it. A task the
// model starts can need a pool thread first, which a loaded CI runner may delay,
// so this polls up to a generous limit instead of counting yields. Nothing
// asserts that time passed; the limit only ends a hang.
private func eventually(
    _ what: String, file: StaticString = #filePath, line: UInt = #line, _ condition: () -> Bool
) async throws {
    for _ in 0..<10_000 {
        if condition() { return }
        try await Task.sleep(nanoseconds: 1_000_000)
    }
    XCTFail("never happened: \(what)", file: file, line: line)
}

// Lets tasks that were already runnable finish; only for "nothing else happened" checks, which
// a slow runner can only make pass sooner, never fail
private func settle() async {
    for _ in 0..<200 { await Task.yield() }
}

@MainActor
private final class FakeAccountsPage {
    var calls: [(name: String, args: String)] = []
    var list: String
    // cursor -> page JSON; nil cursor is the first page
    var pages: [String?: String] = [:]
    var failures: [String: Error] = [:]
    var syncResult = #"{"ok":true}"#
    // search text -> page, so a test can tell which search's rows it got
    var searchPages: [String: String] = [:]
    // A read for this search text waits here until `release` (a slow first search)
    private var held: [String: CheckedContinuation<Void, Never>] = [:]
    private var holding: Set<String> = []

    func hold(_ search: String) { holding.insert(search) }

    func isWaiting(_ search: String) -> Bool { held[search] != nil }

    func release(_ search: String) {
        holding.remove(search)
        held.removeValue(forKey: search)?.resume()
    }

    fileprivate func waitIfHeld(_ search: String) async {
        guard holding.contains(search) else { return }
        await withCheckedContinuation { held[search] = $0 }
    }

    init() throws {
        list = try fixture("accounts-list")
        pages[nil] = try fixture("account-register")
    }

    var client: NativeBridgeClient {
        NativeBridgeClient(timeout: 1) { name, args in
            if name == "native/account-register",
               let request = try JSONSerialization.jsonObject(with: Data(args.utf8)) as? [String: Any],
               let search = request["search"] as? String
            {
                await self.waitIfHeld(search)
            }
            return try await MainActor.run {
                self.calls.append((name, args))
                if let failure = self.failures[name] { throw failure }
                switch name {
                case "native/accounts-list": return self.list
                case "sync": return self.syncResult
                default:
                    let request = try JSONSerialization.jsonObject(with: Data(args.utf8)) as! [String: Any]
                    if let search = request["search"] as? String, let page = self.searchPages[search] { return page }
                    return self.pages[request["cursor"] as? String] ?? self.pages[nil]!
                }
            }
        }
    }

    func count(_ name: String) -> Int { calls.filter { $0.name == name }.count }
    func requests() throws -> [[String: Any]] {
        try calls.filter { $0.name == "native/account-register" }.map {
            try JSONSerialization.jsonObject(with: Data($0.args.utf8)) as! [String: Any]
        }
    }
}

@MainActor
final class AccountsListViewModelTests: XCTestCase {
    private let clock = ManualClock()

    private func model(_ page: FakeAccountsPage) -> AccountsListViewModel {
        AccountsListViewModel(client: page.client, schedule: clock.schedule)
    }

    private func expected(_ page: FakeAccountsPage) throws -> AccountsList {
        try JSONDecoder().decode(AccountsList.self, from: Data(page.list.utf8))
    }

    func testTheFirstLoadIsRedactedThenShowsWhatLootCoreSent() async throws {
        let page = try FakeAccountsPage()
        let model = model(page)
        XCTAssertEqual(model.state, .loading)
        await model.load()
        XCTAssertEqual(model.state, .loaded(try expected(page)))
        XCTAssertEqual(page.calls.map(\.name), ["native/accounts-list"])
    }

    func testAFailedFirstReadShowsTheError() async throws {
        let page = try FakeAccountsPage()
        page.failures["native/accounts-list"] = Boom()
        let model = model(page)
        await model.load()
        XCTAssertEqual(model.state, .failed(.other))
        page.failures["native/accounts-list"] = NativeBridgeError.timedOut("native/accounts-list")
        await model.load()
        XCTAssertEqual(model.state, .failed(.timedOut))
    }

    func testAFailedOrTimedOutReReadKeepsTheLastValues() async throws {
        let page = try FakeAccountsPage()
        let model = model(page)
        await model.load()
        page.failures["native/accounts-list"] = NativeBridgeError.timedOut("native/accounts-list")
        await model.load()
        XCTAssertEqual(model.state, .stale(try expected(page), .timedOut))
        page.failures["native/accounts-list"] = Boom()
        await model.load()
        XCTAssertEqual(model.state, .stale(try expected(page), .other))
        page.failures = [:]
        await model.load()
        XCTAssertEqual(model.state, .loaded(try expected(page)))
    }

    func testABurstOfChangeEventsIsOneReRead() async throws {
        let page = try FakeAccountsPage()
        let model = model(page)
        await model.load()
        for table in ["transactions", "accounts", "preferences", "payees", "categories"] {
            model.eventReceived("sync-event", tables: [table])
        }
        XCTAssertEqual(clock.scheduled, 1, "the burst shares one timer")
        clock.fireChanges()
        try await eventually("one re-read") { page.count("native/accounts-list") == 2 }
        await settle()
        XCTAssertEqual(page.count("native/accounts-list"), 2)
        XCTAssertEqual(clock.scheduled, 1)
    }

    func testEventsThatTouchNothingItShowsAreIgnored() async throws {
        let page = try FakeAccountsPage()
        let model = model(page)
        await model.load()
        model.eventReceived("sync-event", tables: ["schedules"])
        model.eventReceived("sync-event", tables: [])
        XCTAssertEqual(clock.scheduled, 0)
        XCTAssertEqual(page.count("native/accounts-list"), 1)
    }

    func testNothingIsReadInTheBackgroundAndItReReadsOnReturn() async throws {
        let page = try FakeAccountsPage()
        let model = model(page)
        await model.load()
        await model.setSceneActive(false)
        model.eventReceived("sync-event", tables: ["accounts"])
        XCTAssertEqual(clock.scheduled, 0)
        XCTAssertEqual(page.count("native/accounts-list"), 1)
        await model.setSceneActive(true)
        XCTAssertEqual(page.count("native/accounts-list"), 2)
    }

    func testPullingDownRunsOneSyncAndReReadsWithoutABankSync() async throws {
        let page = try FakeAccountsPage()
        let model = model(page)
        await model.load()
        await model.refresh()
        XCTAssertEqual(page.count("sync"), 1)
        XCTAssertEqual(page.count("native/accounts-list"), 2)
        XCTAssertEqual(page.count("accounts-bank-sync"), 0)
        XCTAssertNil(model.refreshError)
    }

    func testAFailedPullKeepsTheLastValuesAndNamesWhatFailed() async throws {
        let page = try FakeAccountsPage()
        let model = model(page)
        await model.load()
        page.syncResult = #"{"ok":false,"reason":"network"}"#
        await model.refresh()
        XCTAssertEqual(model.refreshError, .offline)
        XCTAssertEqual(model.state.value, try expected(page))
        XCTAssertEqual(page.count("native/accounts-list"), 1)
    }
}

@MainActor
final class AccountRegisterViewModelTests: XCTestCase {
    private let clock = ManualClock()

    private func model(_ page: FakeAccountsPage) -> AccountRegisterViewModel {
        AccountRegisterViewModel(client: page.client, accountId: "checking", schedule: clock.schedule, sleep: clock.sleep)
    }

    private func twoPages(_ page: FakeAccountsPage) throws {
        page.pages[nil] = try registerPage(ids: ["a1", "a2"], next: "c1", header: true)
        page.pages["c1"] = try registerPage(ids: ["b1", "b2"], next: "c2", header: false)
        page.pages["c2"] = try registerPage(ids: ["c1x"], next: nil, header: false)
    }

    func testTheFirstLoadAsksForTheFirstPageOfTheAccountAndShowsItsRows() async throws {
        let page = try FakeAccountsPage()
        let model = model(page)
        XCTAssertEqual(model.state, .loading)
        await model.load()
        let request = try read(page.requests(), at: 0)
        XCTAssertEqual(request["account_id"] as? String, "checking")
        XCTAssertEqual(request["scope"] as? String, "all")
        XCTAssertNil(request["cursor"])
        XCTAssertNil(request["search"])
        let fixtureRegister = try JSONDecoder().decode(AccountRegister.self, from: Data(try fixture("account-register").utf8))
        XCTAssertEqual(model.state.value?.rows, fixtureRegister.rows)
        XCTAssertEqual(model.state.value?.header, fixtureRegister.header)
    }

    func testPagingAppendsEachPageAndStopsAtANullCursor() async throws {
        let page = try FakeAccountsPage()
        try twoPages(page)
        let model = model(page)
        await model.load()
        XCTAssertEqual(model.state.value?.rows.map(\.id), ["a1", "a2"])
        await model.loadMore()
        XCTAssertEqual(model.state.value?.rows.map(\.id), ["a1", "a2", "b1", "b2"])
        await model.loadMore()
        XCTAssertEqual(model.state.value?.rows.map(\.id), ["a1", "a2", "b1", "b2", "c1x"])
        XCTAssertFalse(model.hasMore)
        let before = page.count("native/account-register")
        await model.loadMore()
        XCTAssertEqual(page.count("native/account-register"), before)
        XCTAssertEqual(try page.requests().compactMap { $0["cursor"] as? String }, ["c1", "c2"])
    }

    func testAFailedPageKeepsTheRowsAndAllowsARetry() async throws {
        let page = try FakeAccountsPage()
        try twoPages(page)
        let model = model(page)
        await model.load()
        page.failures["native/account-register"] = NativeBridgeError.timedOut("native/account-register")
        await model.loadMore()
        XCTAssertEqual(model.state.value?.rows.map(\.id), ["a1", "a2"])
        XCTAssertEqual(model.state, .stale(model.state.value!, .timedOut))
        page.failures = [:]
        await model.loadMore()
        XCTAssertEqual(model.state.value?.rows.map(\.id), ["a1", "a2", "b1", "b2"])
    }

    func testSearchWaitsForTheTypingToPauseThenReadsFromTheFirstPage() async throws {
        let page = try FakeAccountsPage()
        try twoPages(page)
        let model = model(page)
        await model.load()
        await model.loadMore()
        await model.setSearch("gr")
        await model.setSearch("groc")
        try await eventually("both pauses started") { clock.pauses == 2 }
        clock.endPauses()
        try await eventually("the search read") { (try? page.requests().count) == 3 }
        try await eventually("the first page replaced the pages") { model.state.value?.rows.map(\.id) == ["a1", "a2"] }
        await settle()
        let requests = try page.requests()
        XCTAssertEqual(requests.count, 3, "the cancelled search never read")
        let search = try read(requests, at: 2)
        XCTAssertEqual(search["search"] as? String, "groc")
        XCTAssertNil(search["cursor"])
    }

    // Typing calls arrive in order, but a slow read for an earlier search can finish after the
    // read for a later one: the later search's rows stay
    func testALaterSearchWinsWhateverOrderTheReadsFinishIn() async throws {
        let page = try FakeAccountsPage()
        page.searchPages["gr"] = try registerPage(ids: ["old"], next: nil, header: false)
        page.searchPages["groc"] = try registerPage(ids: ["new"], next: nil, header: false)
        page.hold("gr")
        let model = model(page)
        await model.setSearch("gr")
        try await eventually("the pause started") { clock.pauses == 1 }
        clock.endPauses()
        // The read for "gr" is now in flight and held
        try await eventually("the first read started") { page.isWaiting("gr") }
        await model.setSearch("groc")
        try await eventually("the second pause started") { clock.pauses == 2 }
        clock.endPauses()
        try await eventually("the later read finished") { model.state.value?.rows.map(\.id) == ["new"] }
        page.release("gr")
        await settle()
        XCTAssertEqual(model.state.value?.rows.map(\.id), ["new"])
        XCTAssertEqual(model.search, "groc")
    }

    func testClearingTheSearchSendsNoSearch() async throws {
        let page = try FakeAccountsPage()
        let model = model(page)
        await model.setSearch("x")
        try await eventually("the pause started") { clock.pauses == 1 }
        clock.endPauses()
        try await eventually("search") { (try? page.requests().count) == 1 }
        await model.setSearch("")
        try await eventually("the second pause started") { clock.pauses == 2 }
        clock.endPauses()
        try await eventually("clear") { (try? page.requests().count) == 2 }
        XCTAssertNil(try read(page.requests(), at: 1)["search"])
    }

    func testASearchOver100UTF16UnitsIsNotSent() async throws {
        let page = try FakeAccountsPage()
        let model = model(page)
        await model.setSearch(String(repeating: "😀", count: 51))
        await settle()
        XCTAssertEqual(clock.pauses, 0)
        clock.endPauses()
        await settle()
        XCTAssertEqual(page.count("native/account-register"), 0)
    }

    func testChangingTheScopeStartsOverFromTheFirstPage() async throws {
        let page = try FakeAccountsPage()
        try twoPages(page)
        let model = model(page)
        await model.load()
        await model.loadMore()
        await model.setScope(.uncleared)
        let last = try page.requests().last!
        XCTAssertEqual(last["scope"] as? String, "uncleared")
        XCTAssertNil(last["cursor"])
        XCTAssertEqual(model.state.value?.rows.map(\.id), ["a1", "a2"])
    }

    func testABurstOfChangesReReadsTheLoadedPagesFromTheTopOnce() async throws {
        let page = try FakeAccountsPage()
        try twoPages(page)
        let model = model(page)
        await model.load()
        await model.loadMore()
        let before = try page.requests().count
        for table in ["transactions", "payees", "categories", "accounts", "preferences"] {
            model.eventReceived("sync-event", tables: [table])
        }
        XCTAssertEqual(clock.scheduled, 1, "the burst shares one timer")
        clock.fireChanges()
        try await eventually("re-read of two pages") { (try? page.requests().count) == before + 2 }
        await settle()
        let requests = try page.requests()
        XCTAssertEqual(requests.count, before + 2)
        XCTAssertNil(try read(requests, at: before)["cursor"])
        XCTAssertEqual(try read(requests, at: before + 1)["cursor"] as? String, "c1")
        XCTAssertEqual(model.state.value?.rows.map(\.id), ["a1", "a2", "b1", "b2"])
    }

    func testAReReadThatFailsKeepsTheRowsOnScreen() async throws {
        let page = try FakeAccountsPage()
        try twoPages(page)
        let model = model(page)
        await model.load()
        await model.loadMore()
        page.failures["native/account-register"] = NativeBridgeError.timedOut("native/account-register")
        await model.reload()
        XCTAssertEqual(model.state.value?.rows.map(\.id), ["a1", "a2", "b1", "b2"])
        XCTAssertEqual(model.state, .stale(model.state.value!, .timedOut))
    }

    func testNothingIsReadInTheBackgroundAndItReReadsOnReturn() async throws {
        let page = try FakeAccountsPage()
        let model = model(page)
        await model.load()
        await model.setSceneActive(false)
        model.eventReceived("sync-event", tables: ["transactions"])
        XCTAssertEqual(clock.scheduled, 0)
        XCTAssertEqual(page.count("native/account-register"), 1)
        await model.loadMore()
        XCTAssertEqual(page.count("native/account-register"), 1)
        await model.setSceneActive(true)
        XCTAssertEqual(page.count("native/account-register"), 2)
    }

    func testPullingDownRunsOneSyncAndReReadsTheLoadedPages() async throws {
        let page = try FakeAccountsPage()
        let model = model(page)
        await model.load()
        await model.refresh()
        XCTAssertEqual(page.count("sync"), 1)
        XCTAssertEqual(page.count("native/account-register"), 2)
        XCTAssertEqual(page.count("accounts-bank-sync"), 0)
    }
}
