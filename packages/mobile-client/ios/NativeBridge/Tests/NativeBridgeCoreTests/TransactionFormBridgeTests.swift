import Foundation
import XCTest

@testable import NativeBridgeCore

// native-add-transaction (sc-3602): the Swift half of the Add transaction
// reads' contract. Decodes the fixtures loot-core's transaction-form.test.ts
// writes, and checks the allowlist and the field error codes.
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

final class TransactionFormContractTests: XCTestCase {
    func testDecodesTheEditFormFixture() throws {
        let data = try fixture("transaction-form")
        let form = try JSONDecoder().decode(TransactionForm.self, from: data)
        XCTAssertNil(form.defaults)
        let t = try XCTUnwrap(form.transaction)
        XCTAssertEqual(t.id, "split")
        XCTAssertEqual(t.amount, -3000)
        XCTAssertEqual(t.splits.map(\.id), ["split/a", "split/b"])
        XCTAssertEqual(t.splits[1].transferAccount, AccountRegister.TransferAccount(id: "savings", name: "Savings"))
        XCTAssertEqual(t.splits[1].partner?.account, "savings")
        XCTAssertEqual(t.splits[1].partner?.amount, 2000)
        XCTAssertNil(t.splits[0].partner)
        XCTAssertFalse(t.digest.isEmpty)
        XCTAssertTrue(try roundTrips(TransactionForm.self, data))
    }

    func testDecodesTheAddFormFixture() throws {
        let data = try fixture("transaction-form-add")
        let form = try JSONDecoder().decode(TransactionForm.self, from: data)
        XCTAssertEqual(form.defaults?.account, "savings")
        XCTAssertNil(form.transaction)
        XCTAssertEqual(form.accounts.map(\.id), ["checking", "savings", "house"])
        XCTAssertEqual(form.categoryGroups.flatMap(\.categories).filter(\.hidden).map(\.id), ["secret", "stash"])
        XCTAssertEqual(form.accounts.map(\.transferPayee), ["to-checking", "to-savings", "to-house"])
        XCTAssertTrue(try roundTrips(TransactionForm.self, data))
    }

    func testAChangedFormShapeFails() throws {
        var json = try JSONSerialization.jsonObject(with: fixture("transaction-form")) as! [String: Any]
        json["renamedField"] = 1
        XCTAssertFalse(try roundTrips(TransactionForm.self, JSONSerialization.data(withJSONObject: json)))
    }

    func testDecodesThePayeesFixture() throws {
        let data = try fixture("payees")
        let list = try JSONDecoder().decode(PayeeList.self, from: data)
        XCTAssertEqual(list.payees.first?.name, "Corner Store")
        XCTAssertEqual(list.payees.first?.favorite, true)
        XCTAssertTrue(try roundTrips(PayeeList.self, data))
    }

    func testDecodesThePreviewFixtures() throws {
        let data = try fixture("transaction-preview")
        let preview = try JSONDecoder().decode(TransactionPreview.self, from: data)
        XCTAssertEqual(preview.amount, -1000)
        XCTAssertEqual(preview.draft.category, "groceries")
        XCTAssertEqual(preview.ruleFields, [.category, .notes])
        XCTAssertTrue(try roundTrips(TransactionPreview.self, data))

        let replacedData = try fixture("transaction-preview-replaced")
        let replaced = try JSONDecoder().decode(TransactionPreview.self, from: replacedData)
        XCTAssertEqual(replaced.replaced, [.init(field: .category, value: .text("dining"))])
        XCTAssertTrue(try roundTrips(TransactionPreview.self, replacedData))

        let splitData = try fixture("transaction-preview-split")
        let split = try JSONDecoder().decode(TransactionPreview.self, from: splitData)
        XCTAssertEqual(split.splitAmounts, [-1000, -500])
        XCTAssertEqual(split.remaining, -1500)
        XCTAssertEqual(split.errors["splits"]?.code, .splitMismatch)
        XCTAssertTrue(try roundTrips(TransactionPreview.self, splitData))
    }

    func testAnAmountErrorCarriesTheDecimalSeparator() throws {
        let json = #"{"amount":{"code":"amount-invalid","detail":{"decimalSeparator":","}},"notes":{"code":"notes-too-long"}}"#
        let errors = try JSONDecoder().decode([String: TransactionPreview.FieldError].self, from: Data(json.utf8))
        XCTAssertEqual(errors["amount"]?.detail?.decimalSeparator, ",")
        XCTAssertNil(errors["notes"]?.detail)
    }

    func testAnAmountRestoreValueRoundTrips() throws {
        let value = TransactionPreview.PreviousValue.amount(amountText: "12.50", inflow: false)
        let data = try JSONEncoder().encode(value)
        XCTAssertEqual(try JSONDecoder().decode(TransactionPreview.PreviousValue.self, from: data), value)
    }

    func testTheFieldErrorsAreTheirFixtureAndShareNoCodeWithTheRefusals() throws {
        let fields = try JSONDecoder().decode([String].self, from: fixture("transaction-field-errors"))
        XCTAssertEqual(TransactionFieldError.allCases.map(\.rawValue), fields)
        let refusals = Set(try JSONDecoder().decode([String].self, from: fixture("native-refusal-codes")))
        XCTAssertTrue(refusals.isDisjoint(with: fields))
        XCTAssertEqual(NativeRefusal("[native:not-found] x")?.code, .notFound)
    }

    func testTheReadsAreAllowlistedAndTheRawHandlersAreNot() {
        for name in ["native/transaction-form", "native/payees", "native/transaction-preview"] {
            XCTAssertTrue(NativeBridgeAllowlist.handlers.contains(name), name)
        }
        for name in ["transactions-batch-update", "transaction-add", "rules-run", "payee-create"] {
            XCTAssertFalse(NativeBridgeAllowlist.handlers.contains(name), name)
        }
    }

    func testTheFormRequestSendsTheListedFields() throws {
        let data = try JSONEncoder().encode(TransactionFormRequest(id: "t", accountId: "a"))
        XCTAssertEqual(
            try JSONSerialization.jsonObject(with: data) as? [String: String], ["id": "t", "account_id": "a"])
    }
}
