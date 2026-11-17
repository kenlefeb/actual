import Foundation
import XCTest

@testable import NativeBridgeCore

// native-reconcile-flow (sc-4801, task 2.5): the three view models against a
// fake page and loot-core's fixtures. Swift reads, sends a typed write and
// reads again; every amount and difference is loot-core's.
private let fixturesDir = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("loot-core/src/server/native/fixtures")

private func json(_ name: String) throws -> String {
    String(decoding: try Data(contentsOf: fixturesDir.appendingPathComponent("\(name).json")), as: UTF8.self)
}

private func object(_ name: String) throws -> [String: Any] {
    try JSONSerialization.jsonObject(with: Data(json(name).utf8)) as! [String: Any]
}

private func encode(_ value: Any) -> String {
    String(decoding: try! JSONSerialization.data(withJSONObject: value, options: .sortedKeys), as: UTF8.self)
}

private struct Boom: Error {}

@MainActor
private final class FakeReconcilePage {
    var calls: [(name: String, args: String)] = []
    var results: [String: String] = [:]
    var failures: [String: Error] = [:]

    init() throws {
        results = [
            "native/reconcile-month": try json("reconcile-month"),
            "native/reconcile-rows": try json("reconcile-rows"),
            "account-statement-balance-prefill": try json("statement-balance-prefill"),
            "native/reconcile-tick": #"{"statement":95000,"cleared":100820,"difference":-5820}"#,
        ]
    }

    var client: NativeBridgeClient {
        NativeBridgeClient(timeout: 1) { name, args in
            try await MainActor.run {
                self.calls.append((name, args))
                if let failure = self.failures[name] { throw failure }
                // As loot-core: the next rows read carries the tick's summary
                if name == "native/reconcile-tick", let summary = self.results[name], let rows = self.results["native/reconcile-rows"] {
                    var read = try JSONSerialization.jsonObject(with: Data(rows.utf8)) as! [String: Any]
                    read["summary"] = try JSONSerialization.jsonObject(with: Data(summary.utf8))
                    self.results["native/reconcile-rows"] = encode(read)
                }
                return self.results[name] ?? "null"
            }
        }
    }

    func args(_ name: String) -> [String] { calls.filter { $0.name == name }.map(\.args) }
}

@MainActor
final class ReconcileMonthViewModelTests: XCTestCase {
    func testGroupsDueAndDoneAndHidesReady() async throws {
        let page = try FakeReconcilePage()
        var month = try object("reconcile-month")
        var accounts = month["accounts"] as! [[String: Any]]
        accounts[0]["status"] = "ready"
        accounts[1]["status"] = "done"
        accounts[2]["status"] = "in-progress"
        month["accounts"] = accounts
        page.results["native/reconcile-month"] = encode(month)
        let model = ReconcileMonthViewModel(client: page.client, changeInterval: 0.001)
        await model.load()
        // Ready to confirm has no source yet (D6, sc-4836): built, never shown,
        // so a ready account stays in Due
        XCTAssertFalse(ReconcileMonthViewModel.showsReady)
        XCTAssertEqual(model.ready.map(\.id), ["checking"])
        XCTAssertEqual(model.due.map(\.id), ["checking", "card"])
        XCTAssertEqual(model.done.map(\.id), ["savings"])
        XCTAssertEqual(model.doneCount, 1)
        XCTAssertEqual(model.openAccounts, ["checking", "savings", "card"])
    }

    func testAFailedReReadKeepsTheLastValues() async throws {
        let page = try FakeReconcilePage()
        let model = ReconcileMonthViewModel(client: page.client, changeInterval: 0.001)
        await model.load()
        page.failures["native/reconcile-month"] = NativeBridgeError.timedOut("native/reconcile-month")
        await model.load()
        guard case .stale(let read, .timedOut) = model.state else { return XCTFail("\(model.state)") }
        XCTAssertEqual(read.accounts.count, 3)
    }

    func testEditListWritesExclusionsAndReadsAgain() async throws {
        let page = try FakeReconcilePage()
        let model = ReconcileMonthViewModel(client: page.client, changeInterval: 0.001)
        await model.load()
        await model.remove("card")
        XCTAssertEqual(page.args("native/reconcile-list-set"), [#"{"excluded":["card"]}"#])
        XCTAssertEqual(page.args("native/reconcile-month").count, 2)
        var month = try object("reconcile-month")
        month["excluded"] = ["card", "closed-one"]
        month["hidden"] = [["id": "card", "name": "Card"]]
        page.results["native/reconcile-month"] = encode(month)
        await model.load()
        await model.restore("card")
        // A closed account stays excluded: only the re-added id leaves the list
        XCTAssertEqual(page.args("native/reconcile-list-set").last, #"{"excluded":["closed-one"]}"#)
    }

    func testReReadsOnceForABurstOfWatchedTables() async throws {
        let page = try FakeReconcilePage()
        let model = ReconcileMonthViewModel(client: page.client, changeInterval: 0.001)
        await model.load()
        model.eventReceived("sync-event", tables: ["transactions"])
        model.eventReceived("sync-event", tables: ["preferences"])
        model.eventReceived("sync-event", tables: ["categories"])
        try await waitUntil("re-read") { page.args("native/reconcile-month").count == 2 }
        for _ in 0..<50 { await Task.yield() }
        XCTAssertEqual(page.args("native/reconcile-month").count, 2)
    }

    func testPresentReconcileTakesOnlyAnOpenAccount() async throws {
        let page = try FakeReconcilePage()
        let model = ReconcileMonthViewModel(client: page.client, changeInterval: 0.001)
        // Nothing read yet: nothing is known to be open
        XCTAssertNil(model.request(from: ["type": "presentReconcile", "account_id": "checking"]))
        await model.load()
        XCTAssertEqual(model.request(from: ["type": "presentReconcile", "account_id": "checking"]), .account("checking"))
        XCTAssertNil(model.request(from: ["type": "presentReconcile", "account_id": "old"]))
    }
}

@MainActor
final class ReconcileStepOneViewModelTests: XCTestCase {
    private func model(_ page: FakeReconcilePage) async throws -> ReconcileStepOneViewModel {
        let month = try JSONDecoder().decode(ReconcileMonth.self, from: Data(json("reconcile-month").utf8))
        let model = ReconcileStepOneViewModel(client: page.client, accountId: "checking", style: month.amountStyle)
        await model.load()
        return model
    }

    func testPrefillsTheBankBalance() async throws {
        let model = try await model(FakeReconcilePage())
        XCTAssertEqual(model.text, "465.41")
        XCTAssertEqual(model.source, .bankSync(asOf: "2016-12-31"))
        XCTAssertTrue(model.canConfirm)
        XCTAssertEqual(model.cleared?.amount, 105000)
        XCTAssertNil(model.staleBank)
    }

    // UX review (PR 399): the field shows the amount as the app does elsewhere
    func testTheFieldUsesTheBudgetsFormat() async throws {
        let page = try FakeReconcilePage()
        var prefill = try object("statement-balance-prefill")
        prefill["prefill"] = ["amount": 465413, "source": "bank-sync", "as_of": "2016-12-31", "link": "bank-sync"]
        page.results["account-statement-balance-prefill"] = encode(prefill)
        let usd = BudgetAmountStyle(
            currencyCode: "USD", currencySymbol: "$", decimalPlaces: 2, symbolPosition: .before, symbolSpace: false,
            numberFormat: .commaDot, hideFraction: false)
        let model = ReconcileStepOneViewModel(client: page.client, accountId: "checking", style: usd)
        await model.load()
        XCTAssertEqual(model.text, "$4,654.13")
        XCTAssertEqual(model.source, .bankSync(asOf: "2016-12-31"))
        model.text = "-$1,288.40"
        XCTAssertEqual(model.amount, -128840)
        XCTAssertEqual(model.source, .entered)
        model.useCleared()
        XCTAssertEqual(model.text, "$1,050.00")
        XCTAssertEqual(model.source, .cleared)
    }

    func testAnEditReadsEnteredByYouAndRestores() async throws {
        let model = try await model(FakeReconcilePage())
        model.text = "465.00"
        XCTAssertEqual(model.source, .entered)
        model.restoreBankBalance()
        XCTAssertEqual(model.text, "465.41")
        XCTAssertEqual(model.source, .bankSync(asOf: "2016-12-31"))
    }

    func testNoSourceIsEmptyAndConfirmIsOff() async throws {
        let page = try FakeReconcilePage()
        var prefill = try object("statement-balance-prefill")
        prefill["prefill"] = NSNull()
        page.results["account-statement-balance-prefill"] = encode(prefill)
        let model = try await model(page)
        XCTAssertEqual(model.text, "")
        XCTAssertEqual(model.source, .none)
        XCTAssertFalse(model.canConfirm)
        model.useCleared()
        XCTAssertEqual(model.source, .cleared)
        XCTAssertTrue(model.canConfirm)
    }

    func testAStaleBankBalanceIsOfferedNotPrefilled() async throws {
        let page = try FakeReconcilePage()
        var prefill = try object("statement-balance-prefill")
        let bank = prefill["prefill"]!
        prefill["prefill"] = NSNull()
        prefill["alternatives"] = [bank] + (prefill["alternatives"] as! [Any])
        page.results["account-statement-balance-prefill"] = encode(prefill)
        let model = try await model(page)
        XCTAssertEqual(model.text, "")
        XCTAssertEqual(model.staleBank?.asOf, "2016-12-31")
        model.useStaleBank()
        XCTAssertEqual(model.source, .bankSync(asOf: "2016-12-31"))
    }

    func testConfirmSavesWithTheSourceAndNoWho() async throws {
        let page = try FakeReconcilePage()
        let model = try await model(page)
        var saved = await model.confirm()
        XCTAssertTrue(saved)
        XCTAssertEqual(
            page.args("account-statement-balance-save"),
            [#"{"account_id":"checking","amount":46541,"as_of":"2016-12-31","source":"bank-sync"}"#])
        model.text = "-12.50"
        saved = await model.confirm()
        XCTAssertTrue(saved)
        XCTAssertEqual(page.args("account-statement-balance-save").last, #"{"account_id":"checking","amount":-1250,"source":"entered"}"#)
        XCTAssertFalse(model.showsClearedNote)
        model.useCleared()
        saved = await model.confirm()
        XCTAssertTrue(saved)
        XCTAssertTrue(model.showsClearedNote)
    }

    func testAFailedSaveSaysSoAndMovesOn() async throws {
        let page = try FakeReconcilePage()
        page.failures["account-statement-balance-save"] = Boom()
        let model = try await model(page)
        let saved = await model.confirm()
        XCTAssertFalse(saved)
        XCTAssertNotNil(model.error)
    }
}

@MainActor
final class ReconcileTickViewModelTests: XCTestCase {
    func testLoadsRowsAndTheSummary() async throws {
        let page = try FakeReconcilePage()
        let model = ReconcileTickViewModel(client: page.client, accountId: "checking", changeInterval: 0.001)
        await model.load()
        XCTAssertEqual(model.rows.map(\.id), ["split", "food"])
        XCTAssertEqual(model.summary?.difference, -10000)
        XCTAssertEqual(page.args("native/reconcile-rows"), [#"{"account_id":"checking","scope":"to-tick"}"#])
        model.scope = .all
        await model.load()
        XCTAssertEqual(page.args("native/reconcile-rows").last, #"{"account_id":"checking","scope":"all"}"#)
    }

    func testATickTakesLootCoresSummaryAndAnnouncesTheDifference() async throws {
        let page = try FakeReconcilePage()
        let model = ReconcileTickViewModel(client: page.client, accountId: "checking", changeInterval: 0.001)
        await model.load()
        await model.toggle(model.rows[1])
        let tick = try XCTUnwrap(page.args("native/reconcile-tick").first)
        XCTAssertTrue(tick.contains(#""ids":["food"]"#) && tick.contains(#""cleared":true"#))
        XCTAssertEqual(model.summary, ReconcileSummary(statement: 95000, cleared: 100820, difference: -5820))
        XCTAssertNotNil(model.announcement)
        XCTAssertEqual(page.args("native/reconcile-rows").count, 2)
    }

    func testAReconciledRowIsNeverSent() async throws {
        let page = try FakeReconcilePage()
        var rows = try object("reconcile-rows")
        var list = rows["rows"] as! [[String: Any]]
        list[0]["reconciled"] = true
        rows["rows"] = list
        page.results["native/reconcile-rows"] = encode(rows)
        let model = ReconcileTickViewModel(client: page.client, accountId: "checking", changeInterval: 0.001)
        await model.load()
        await model.toggle(model.rows[0])
        XCTAssertTrue(page.args("native/reconcile-tick").isEmpty)
    }

    func testAFailedTickKeepsTheValues() async throws {
        let page = try FakeReconcilePage()
        page.failures["native/reconcile-tick"] = Boom()
        let model = ReconcileTickViewModel(client: page.client, accountId: "checking", changeInterval: 0.001)
        await model.load()
        await model.toggle(model.rows[1])
        XCTAssertEqual(model.summary?.difference, -10000)
        XCTAssertFalse(model.rows[1].cleared)
        XCTAssertNotNil(model.error)
    }

    func testTheExitFollowsTheDifference() async throws {
        let page = try FakeReconcilePage()
        let model = ReconcileTickViewModel(client: page.client, accountId: "checking", changeInterval: 0.001)
        await model.load()
        XCTAssertEqual(model.exit, .doneForNow)
        page.results["native/reconcile-tick"] = #"{"statement":95000,"cleared":95000,"difference":0}"#
        await model.toggle(model.rows[1])
        // sc-4825: at zero, Continue to lock, with "Difference zero" and a haptic; no auto-advance
        XCTAssertEqual(model.exit, .continueToLock)
        XCTAssertEqual(model.announcement, "Difference zero")
        XCTAssertEqual(model.zeroCount, 1)
    }
}
