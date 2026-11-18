import Foundation
import XCTest

@testable import NativeBridgeCore

// native-accounts-screen (sc-4386): the Swift half of the accounts reads'
// contract. Decodes the fixtures loot-core's accounts.test.ts writes, and
// checks the typed request and the allowlist.
private let fixturesDir = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("loot-core/src/server/native/fixtures")

private func fixture(_ name: String) throws -> Data {
    try Data(contentsOf: fixturesDir.appendingPathComponent("\(name).json"))
}

// Re-encoded without nulls and with sorted keys, so a renamed or added field fails
private func canonical(_ data: Data) throws -> String {
    func strip(_ value: Any) -> Any {
        if let dict = value as? [String: Any] { return dict.filter { !($0.value is NSNull) }.mapValues(strip) }
        if let array = value as? [Any] { return array.map(strip) }
        return value
    }
    let object = strip(try JSONSerialization.jsonObject(with: data))
    return String(decoding: try JSONSerialization.data(withJSONObject: object, options: .sortedKeys), as: UTF8.self)
}

private func roundTrips<T: Codable>(_ type: T.Type, _ data: Data) throws -> Bool {
    try canonical(JSONEncoder().encode(JSONDecoder().decode(type, from: data))) == canonical(data)
}

final class AccountsContractTests: XCTestCase {
    func testDecodesTheListFixture() throws {
        let data = try fixture("accounts-list")
        let list = try JSONDecoder().decode(AccountsList.self, from: data)
        XCTAssertEqual(list.sections.onBudget.accounts.map(\.id), ["checking", "savings", "card"])
        XCTAssertEqual(list.sections.onBudget.accounts[0].balance, 92820)
        XCTAssertTrue(list.sections.onBudget.accounts[0].bankSync)
        XCTAssertEqual(list.sections.onBudget.accounts[2].clearingFor, "Acme")
        XCTAssertEqual(list.closed.accounts.map(\.id), ["old"])
        XCTAssertEqual(list.netWorth, list.sections.onBudget.total + list.sections.offBudget.total)
        XCTAssertTrue(try roundTrips(AccountsList.self, data))
    }

    func testAChangedListShapeFails() throws {
        var json = try JSONSerialization.jsonObject(with: fixture("accounts-list")) as! [String: Any]
        json["renamedField"] = 1
        XCTAssertFalse(try roundTrips(AccountsList.self, JSONSerialization.data(withJSONObject: json)))
    }

    func testDecodesTheRegisterFixture() throws {
        let data = try fixture("account-register")
        let page = try JSONDecoder().decode(AccountRegister.self, from: data)
        XCTAssertEqual(page.rows.map(\.id), ["food", "plain", "lock", "split", "out"])
        XCTAssertEqual(page.rows[0].payee, "Grocer")
        XCTAssertEqual(page.rows[3].splitCount, 2)
        XCTAssertEqual(page.rows[4].transferAccount, AccountRegister.TransferAccount(id: "savings", name: "Savings"))
        XCTAssertEqual(page.rows[4].transferReconciled, true)
        XCTAssertNotNil(page.rows[0].runningBalance)
        XCTAssertNil(page.nextCursor)
        XCTAssertEqual(page.header?.balance, page.rows.first?.runningBalance)
        XCTAssertEqual(page.upcoming, [])
        XCTAssertTrue(try roundTrips(AccountRegister.self, data))
    }
}

final class AccountsBridgeTests: XCTestCase {
    func testTheReadsAndTheFourWritesAreAllowlistedButNotTheRawHandlers() {
        XCTAssertTrue(
            NativeBridgeAllowlist.handlers.isSuperset(of: [
                "native/accounts-list", "native/account-register", "native/transactions-categorize",
                "native/transactions-delete", "native/account-reopen", "native/account-move",
            ]))
        for raw in ["account-reopen", "account-move", "transactions-batch-update"] {
            XCTAssertFalse(NativeBridgeAllowlist.handlers.contains(raw))
        }
    }

    func testEachWriteSendsOnlyItsOwnFieldsAndLooseArgumentsAreRefused() async throws {
        var seen: [(String, String)] = []
        let client = NativeBridgeClient { name, args in
            seen.append((name, args))
            return "null"
        }
        try await client.categorizeTransactions(
            try TransactionsCategorize(accountId: "a", ids: ["t1"], category: "c", confirmedReconciled: true, undoToken: "T"))
        try await client.categorizeTransactions(
            try TransactionsCategorize(accountId: "a", ids: ["t1"], category: nil, undoToken: "T"))
        try await client.deleteTransactions(try TransactionsDelete(accountId: "a", ids: ["t1", "t2"], undoToken: "T"))
        try await client.reopenAccount(try AccountReopen(id: "old", undoToken: "T"))
        try await client.moveAccount(try AccountMove(id: "a", targetId: nil, undoToken: "T"))
        XCTAssertEqual(
            seen.map(\.1),
            [
                #"{"account_id":"a","category":"c","confirmedReconciled":true,"ids":["t1"],"undoToken":"T"}"#,
                #"{"account_id":"a","category":null,"confirmedReconciled":false,"ids":["t1"],"undoToken":"T"}"#,
                #"{"account_id":"a","confirmedReconciled":false,"ids":["t1","t2"],"undoToken":"T"}"#,
                #"{"id":"old","undoToken":"T"}"#,
                #"{"id":"a","targetId":null,"undoToken":"T"}"#,
            ])
        for name in ["native/transactions-categorize", "native/transactions-delete", "native/account-reopen", "native/account-move"] {
            do {
                _ = try await client.call(name, args: ["id": "a"])
                XCTFail("\(name) took loose arguments")
            } catch NativeBridgeError.invalidWrite {
            }
        }
        XCTAssertEqual(seen.count, 5)
    }

    func testWritesRefuseWhatLootCoreRefuses() {
        XCTAssertThrowsError(try TransactionsCategorize(accountId: "", ids: ["t"], category: nil, undoToken: "T"))
        XCTAssertThrowsError(try TransactionsCategorize(accountId: "a", ids: [], category: nil, undoToken: "T"))
        XCTAssertThrowsError(try TransactionsCategorize(accountId: "a", ids: ["t"], category: "", undoToken: "T"))
        XCTAssertThrowsError(try TransactionsCategorize(accountId: "a", ids: ["t"], category: nil, undoToken: ""))
        XCTAssertThrowsError(try TransactionsDelete(accountId: "a", ids: [""], undoToken: "T"))
        // 500 is loot-core's ceiling for accounts-write-max-ids; the engine applies the setting
        XCTAssertThrowsError(try TransactionsDelete(accountId: "a", ids: (0...500).map { "t\($0)" }, undoToken: "T"))
        XCTAssertNoThrow(try TransactionsDelete(accountId: "a", ids: (0..<500).map { "t\($0)" }, undoToken: "T"))
        XCTAssertThrowsError(try AccountReopen(id: "", undoToken: "T"))
        XCTAssertThrowsError(try AccountMove(id: "a", targetId: "", undoToken: "T"))
        XCTAssertThrowsError(try AccountMove(id: "a", targetId: "a", undoToken: "T"))
        XCTAssertThrowsError(try AccountMove(id: "a", targetId: nil, undoToken: ""))
    }

    func testRegisterRequestRejectsWhatLootCoreRefuses() {
        XCTAssertThrowsError(try AccountRegisterRequest(accountId: ""))
        XCTAssertThrowsError(try AccountRegisterRequest(accountId: "a", search: String(repeating: "x", count: 101)))
        XCTAssertNoThrow(try AccountRegisterRequest(accountId: "a", search: String(repeating: "x", count: 100)))
    }

    // loot-core counts the search in UTF-16 units (JS `length`); an emoji is two
    func testSearchLengthIsCountedInUTF16UnitsLikeLootCore() {
        XCTAssertNoThrow(try AccountRegisterRequest(accountId: "a", search: String(repeating: "😀", count: 50)))
        XCTAssertThrowsError(try AccountRegisterRequest(accountId: "a", search: String(repeating: "😀", count: 51)))
    }

    func testReadsSendOnlyTheirOwnArguments() async throws {
        var seen: [(String, String)] = []
        let list = String(decoding: try fixture("accounts-list"), as: UTF8.self)
        let page = String(decoding: try fixture("account-register"), as: UTF8.self)
        let client = NativeBridgeClient { name, args in
            seen.append((name, args))
            return name == "native/accounts-list" ? list : page
        }
        _ = try await client.accountsList()
        _ = try await client.accountRegister(try AccountRegisterRequest(accountId: "checking", scope: .uncleared, search: "a%", cursor: "c"))
        XCTAssertEqual(seen[0].0, "native/accounts-list")
        XCTAssertEqual(seen[1].0, "native/account-register")
        XCTAssertEqual(seen[1].1, #"{"account_id":"checking","cursor":"c","scope":"uncleared","search":"a%"}"#)
    }
}
