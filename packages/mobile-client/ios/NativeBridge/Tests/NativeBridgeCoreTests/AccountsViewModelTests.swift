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

@MainActor
private final class FakeAccountsPage {
    var calls: [(name: String, args: String)] = []
    var list: String
    // cursor -> page JSON; nil cursor is the first page
    var pages: [String?: String] = [:]
    var failures: [String: Error] = [:]
    var syncResult = #"{"ok":true}"#

    init() throws {
        list = try fixture("accounts-list")
        pages[nil] = try fixture("account-register")
    }

    var client: NativeBridgeClient {
        NativeBridgeClient(timeout: 1) { name, args in
            try await MainActor.run {
                self.calls.append((name, args))
                if let failure = self.failures[name] { throw failure }
                switch name {
                case "native/accounts-list": return self.list
                case "sync": return self.syncResult
                default:
                    let request = try JSONSerialization.jsonObject(with: Data(args.utf8)) as! [String: Any]
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
    private func model(_ page: FakeAccountsPage) -> AccountsListViewModel {
        AccountsListViewModel(client: page.client, changeInterval: 0.001)
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
        try await waitUntil("one re-read") { page.count("native/accounts-list") == 2 }
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertEqual(page.count("native/accounts-list"), 2)
    }

    func testEventsThatTouchNothingItShowsAreIgnored() async throws {
        let page = try FakeAccountsPage()
        let model = model(page)
        await model.load()
        model.eventReceived("sync-event", tables: ["schedules"])
        model.eventReceived("sync-event", tables: [])
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertEqual(page.count("native/accounts-list"), 1)
    }

    func testNothingIsReadInTheBackgroundAndItReReadsOnReturn() async throws {
        let page = try FakeAccountsPage()
        let model = model(page)
        await model.load()
        await model.setSceneActive(false)
        model.eventReceived("sync-event", tables: ["accounts"])
        try await Task.sleep(nanoseconds: 20_000_000)
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
    private func model(_ page: FakeAccountsPage, searchInterval: TimeInterval = 0.01) -> AccountRegisterViewModel {
        AccountRegisterViewModel(client: page.client, accountId: "checking", searchInterval: searchInterval, changeInterval: 0.001)
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
        let request = try page.requests()[0]
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
        async let first: Void = model.setSearch("gr")
        async let second: Void = model.setSearch("groc")
        _ = await (first, second)
        try await waitUntil("the search read") { (try? page.requests().count) == 3 }
        try await Task.sleep(nanoseconds: 30_000_000)
        let requests = try page.requests()
        XCTAssertEqual(requests.count, 3)
        XCTAssertEqual(requests[2]["search"] as? String, "groc")
        XCTAssertNil(requests[2]["cursor"])
        XCTAssertEqual(model.state.value?.rows.map(\.id), ["a1", "a2"])
    }

    func testClearingTheSearchSendsNoSearch() async throws {
        let page = try FakeAccountsPage()
        let model = model(page)
        await model.setSearch("x")
        try await waitUntil("search") { (try? page.requests().count) == 1 }
        await model.setSearch("")
        try await waitUntil("clear") { (try? page.requests().count) == 2 }
        XCTAssertNil(try page.requests()[1]["search"])
    }

    func testASearchOver100UTF16UnitsIsNotSent() async throws {
        let page = try FakeAccountsPage()
        let model = model(page)
        await model.setSearch(String(repeating: "😀", count: 51))
        try await Task.sleep(nanoseconds: 40_000_000)
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
        try await waitUntil("re-read of two pages") { (try? page.requests().count) == before + 2 }
        try await Task.sleep(nanoseconds: 20_000_000)
        let requests = try page.requests()
        XCTAssertEqual(requests.count, before + 2)
        XCTAssertNil(requests[before]["cursor"])
        XCTAssertEqual(requests[before + 1]["cursor"] as? String, "c1")
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
        try await Task.sleep(nanoseconds: 20_000_000)
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
