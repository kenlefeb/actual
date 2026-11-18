import Foundation
import XCTest

@testable import NativeBridgeCore

// sc-3611 (native-accounts-screen D7, tasks 3.2 to 3.4): what the native
// register shows besides loot-core's numbers (date sections, each row's status
// and which actions it offers) and the row writes with their Undo.
private let fixturesDir = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("loot-core/src/server/native/fixtures")

private func fixture(_ name: String) throws -> String {
    String(decoding: try Data(contentsOf: fixturesDir.appendingPathComponent("\(name).json")), as: UTF8.self)
}

private func register() throws -> AccountRegister {
    try JSONDecoder().decode(AccountRegister.self, from: Data(try fixture("account-register").utf8))
}

private func row(_ id: String) throws -> AccountRegister.Row { try register().rows.first { $0.id == id }! }

private func row(_ id: String, date: String) throws -> AccountRegister.Row {
    let base = try row("food")
    return AccountRegister.Row(
        id: id, date: date, payee: base.payee, category: base.category, splitCount: 0, notes: nil, amount: base.amount, cleared: false,
        reconciled: false, transferAccount: nil, transferReconciled: nil, runningBalance: nil)
}

final class RegisterDayTests: XCTestCase {
    // Newest first as loot-core sent them; a day's rows stay together in that order
    func testRowsGroupByDayInTheOrderLootCoreSent() throws {
        let rows = [try row("a", date: "2026-11-17"), try row("b", date: "2026-11-17"), try row("c", date: "2026-11-12")]
        let days = RegisterDay.days(of: rows)
        XCTAssertEqual(days.map(\.date), ["2026-11-17", "2026-11-12"])
        XCTAssertEqual(days.map { $0.rows.map(\.id) }, [["a", "b"], ["c"]])
    }

    func testTodayYesterdayAndOtherDays() {
        let locale = Locale(identifier: "en_US")
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let today = ISO8601DateFormatter().date(from: "2026-11-17T12:00:00Z")!
        XCTAssertEqual(RegisterDay.title("2026-11-17", today: today, calendar: calendar, locale: locale), "Today")
        XCTAssertEqual(RegisterDay.title("2026-11-16", today: today, calendar: calendar, locale: locale), "Yesterday")
        XCTAssertEqual(RegisterDay.title("2026-11-12", today: today, calendar: calendar, locale: locale), "Thursday, Nov 12")
        XCTAssertEqual(RegisterDay.title("2025-11-12", today: today, calendar: calendar, locale: locale), "Wednesday, Nov 12, 2025")
    }
}

final class RegisterRowTests: XCTestCase {
    func testStatusWords() throws {
        XCTAssertEqual(RegisterRowStatus(try row("food")), .cleared)
        XCTAssertEqual(RegisterRowStatus(try row("plain")), .pending)
        XCTAssertEqual(RegisterRowStatus(try row("lock")), .reconciled)
    }

    func testAnOpenOnBudgetRowOffersEverything() throws {
        let actions = RegisterRowActions(try row("food"), accountOffBudget: false, transferOffBudget: nil, readOnly: false)
        XCTAssertEqual(actions, RegisterRowActions(canClear: true, canCategorize: true, canDelete: true, asksFirst: false))
    }

    // loot-core refuses these (D3); the screen does not offer them
    func testWhatIsNotOffered() throws {
        XCTAssertFalse(RegisterRowActions(try row("lock"), accountOffBudget: false, transferOffBudget: nil, readOnly: false).canClear)
        XCTAssertFalse(RegisterRowActions(try row("split"), accountOffBudget: false, transferOffBudget: nil, readOnly: false).canCategorize)
        XCTAssertFalse(RegisterRowActions(try row("food"), accountOffBudget: true, transferOffBudget: nil, readOnly: false).canCategorize)
        XCTAssertFalse(RegisterRowActions(try row("out"), accountOffBudget: false, transferOffBudget: false, readOnly: false).canCategorize)
        XCTAssertTrue(RegisterRowActions(try row("out"), accountOffBudget: false, transferOffBudget: true, readOnly: false).canCategorize)
    }

    func testAReconciledRowOrPartnerAsksFirst() throws {
        XCTAssertTrue(RegisterRowActions(try row("lock"), accountOffBudget: false, transferOffBudget: nil, readOnly: false).asksFirst)
        XCTAssertTrue(RegisterRowActions(try row("out"), accountOffBudget: false, transferOffBudget: false, readOnly: false).asksFirst)
    }

    // A closed account's register (3.2)
    func testReadOnlyOffersNothing() throws {
        XCTAssertEqual(
            RegisterRowActions(try row("food"), accountOffBudget: false, transferOffBudget: nil, readOnly: true),
            RegisterRowActions(canClear: false, canCategorize: false, canDelete: false, asksFirst: false))
    }
}

private struct Boom: Error {}

@MainActor
private final class FakeRegisterPage {
    var calls: [(name: String, args: String)] = []
    var failures: [String: Error] = [:]

    var client: NativeBridgeClient {
        NativeBridgeClient(timeout: 1) { name, args in
            let register = try fixture("account-register")
            let month = try fixture("budget-month-envelope")
            return try await MainActor.run {
                self.calls.append((name, args))
                if let failure = self.failures[name] { throw failure }
                switch name {
                case "native/account-register": return register
                case "native/budget-month": return month
                case "native/reconcile-tick": return #"{"statement":null,"cleared":0,"difference":null}"#
                default: return "null"
                }
            }
        }
    }

    func args(_ name: String) throws -> [String: Any] {
        let call = try XCTUnwrap(calls.last { $0.name == name })
        return try JSONSerialization.jsonObject(with: Data(call.args.utf8)) as! [String: Any]
    }

    func names() -> [String] { calls.map(\.name) }
}

private final class HeldSleep {
    private var waiting: [CheckedContinuation<Void, Never>] = []
    var sleep: AccountsSleep { { [self] _ in await withCheckedContinuation { waiting.append($0) } } }
    var pending: Int { waiting.count }
    func end() {
        let all = waiting
        waiting = []
        all.forEach { $0.resume() }
    }
}

@MainActor
final class AccountRegisterWriteTests: XCTestCase {
    private let undoClock = HeldSleep()

    private func model(_ page: FakeRegisterPage) -> AccountRegisterViewModel {
        AccountRegisterViewModel(client: page.client, accountId: "checking", schedule: { _, _ in }, undoSleep: undoClock.sleep)
    }

    func testClearingSendsATickReReadsAndOffersUndo() async throws {
        let page = FakeRegisterPage()
        let model = model(page)
        await model.load()
        await model.setCleared(try row("plain"), true)
        let args = try page.args("native/reconcile-tick")
        XCTAssertEqual(args["account_id"] as? String, "checking")
        XCTAssertEqual(args["ids"] as? [String], ["plain"])
        XCTAssertEqual(args["cleared"] as? Bool, true)
        XCTAssertEqual(page.names().last, "native/account-register")
        XCTAssertEqual(model.undoOffer?.token, args["undoToken"] as? String)
        XCTAssertEqual(model.undoOffer?.action, .clear)
    }

    func testCategorizeSendsTheCategoryAndTheConfirmation() async throws {
        let page = FakeRegisterPage()
        let model = model(page)
        await model.load()
        await model.categorize(try row("lock"), category: "groceries", confirmed: true)
        let args = try page.args("native/transactions-categorize")
        XCTAssertEqual(args["ids"] as? [String], ["lock"])
        XCTAssertEqual(args["category"] as? String, "groceries")
        XCTAssertEqual(args["confirmedReconciled"] as? Bool, true)
        XCTAssertEqual(model.undoOffer?.action, .categorize)
    }

    func testDeleteSendsTheRowAndOffersUndo() async throws {
        let page = FakeRegisterPage()
        let model = model(page)
        await model.load()
        await model.delete(try row("out"), confirmed: false)
        let args = try page.args("native/transactions-delete")
        XCTAssertEqual(args["ids"] as? [String], ["out"])
        XCTAssertEqual(args["confirmedReconciled"] as? Bool, false)
        XCTAssertEqual(model.undoOffer?.action, .delete)
        XCTAssertEqual(model.undoOffer?.name, "Savings")
    }

    func testARefusedWriteSaysSoAndOffersNoUndo() async throws {
        let page = FakeRegisterPage()
        page.failures["native/transactions-delete"] = Boom()
        let model = model(page)
        await model.load()
        await model.delete(try row("food"), confirmed: false)
        XCTAssertEqual(model.actionError, .deleteFailed)
        XCTAssertNil(model.undoOffer)
        page.failures["native/reconcile-tick"] = NativeBridgeError.timedOut("native/reconcile-tick")
        await model.setCleared(try row("plain"), true)
        XCTAssertEqual(model.actionError, .timedOut)
    }

    func testUndoAndItsRefusal() async throws {
        let page = FakeRegisterPage()
        let model = model(page)
        await model.load()
        await model.categorize(try row("food"), category: nil, confirmed: false)
        XCTAssertTrue(try page.args("native/transactions-categorize")["category"] is NSNull)
        let token = model.undoOffer?.token
        page.failures["native/undo"] = NativeBridgeError.page("native/undo: changed since, can't undo")
        await model.undo()
        XCTAssertEqual(try page.args("native/undo")["token"] as? String, token)
        XCTAssertEqual(model.actionError, .changedSince)
        XCTAssertNil(model.undoOffer)
    }

    func testTheOfferExpires() async throws {
        let page = FakeRegisterPage()
        let model = model(page)
        await model.load()
        await model.setCleared(try row("plain"), true)
        try await waitUntil("the timer started") { undoClock.pending == 1 }
        undoClock.end()
        try await waitUntil("the offer expired") { model.undoOffer == nil }
    }

    // The picker reads the month's groups (D3: no new read); hidden ones are left out
    func testThePickerListsTheVisibleCategories() async throws {
        let page = FakeRegisterPage()
        let model = model(page)
        await model.loadCategories(month: "2017-01")
        XCTAssertEqual(try page.args("native/budget-month")["month"] as? String, "2017-01")
        let groups = try XCTUnwrap(model.categoryGroups)
        XCTAssertFalse(groups.isEmpty)
        XCTAssertTrue(groups.allSatisfy { !$0.hidden && $0.categories.allSatisfy { !$0.hidden } })
    }
}
