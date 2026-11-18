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
        XCTAssertEqual(preview.result.amount, -1000)
        XCTAssertEqual(preview.result.amountText, "10.00")
        XCTAssertEqual(preview.result.category, "groceries")
        XCTAssertEqual(preview.ruleFields, [.category, .notes])
        XCTAssertEqual(preview.resultDigest.count, 64)
        XCTAssertTrue(try roundTrips(TransactionPreview.self, data))

        let suggestionsData = try fixture("transaction-preview-suggestions")
        let suggested = try JSONDecoder().decode(TransactionPreview.self, from: suggestionsData)
        XCTAssertEqual(suggested.suggestions.map(\.field), [.category, .notes])
        XCTAssertEqual(suggested.suggestions[0].value.name, "Groceries")
        XCTAssertEqual(suggested.suggestions[1].value.text, "Bulk")
        XCTAssertTrue(try roundTrips(TransactionPreview.self, suggestionsData))

        let splitData = try fixture("transaction-preview-split")
        let split = try JSONDecoder().decode(TransactionPreview.self, from: splitData)
        XCTAssertEqual(split.result.splits.map(\.amount), [-1000, -500])
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

    // D3 and D4: the save is a typed write; loose arguments never reach the page
    func testTheSaveIsATypedWriteAndReturnsTheId() async throws {
        var seen: [(String, String)] = []
        let client = NativeBridgeClient { name, args in
            seen.append((name, args))
            return #"{"id":"n"}"#
        }
        let draft = TransactionDraft(
            newId: "0b5f2c1e-8d3a-4f6b-9c2d-1a2b3c4d5e6f", id: nil, account: "a", date: "2016-12-20", payee: nil,
            payeeName: nil, category: nil, notes: "", cleared: false, inflow: false, amountText: "1", splits: [],
            userFields: [])
        let saved = try await client.saveTransaction(
            try TransactionSave(draft: draft, previewDigest: "p", digest: nil, undoToken: "T"))
        XCTAssertEqual(saved, TransactionSaveResult(id: "n"))
        XCTAssertEqual(seen.map(\.0), ["native/transaction-save"])
        XCTAssertTrue(seen[0].1.contains(#""confirmedReconciled":false"#))
        XCTAssertTrue(seen[0].1.contains(#""undoToken":"T""#))
        XCTAssertTrue(seen[0].1.contains(#""previewDigest":"p""#))
        do {
            _ = try await client.call("native/transaction-save", args: ["draft": "x"])
            XCTFail("the save took loose arguments")
        } catch NativeBridgeError.invalidWrite {
        }
        XCTAssertTrue(NativeBridgeAllowlist.transactionWrites.contains("native/transaction-save"))
        XCTAssertThrowsError(try TransactionSave(draft: draft, digest: nil, undoToken: ""))
        XCTAssertEqual(seen.count, 1)
    }
}
