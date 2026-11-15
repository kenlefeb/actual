import Foundation
import XCTest

@testable import NativeBridgeCore

// native-bridge: "The paycheck handlers are allowlisted" and
// native-paychecks-screen: "The editor validates through loot-core" (sc-4343).
// Decodes the fixtures the loot-core editor test writes.
private let packages = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()  // NativeBridgeCoreTests
    .deletingLastPathComponent()  // Tests
    .deletingLastPathComponent()  // NativeBridge
    .deletingLastPathComponent()  // ios
    .deletingLastPathComponent()  // mobile-client
    .deletingLastPathComponent()  // packages

func editorFixture(_ name: String) throws -> Data {
    try Data(contentsOf: packages.appendingPathComponent("loot-core/src/server/native/fixtures/\(name).json"))
}

private func canonical(_ data: Data) throws -> String {
    func strip(_ value: Any) -> Any {
        if let dict = value as? [String: Any] { return dict.filter { !($0.value is NSNull) }.mapValues(strip) }
        if let array = value as? [Any] { return array.map(strip) }
        return value
    }
    let object = strip(try JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed))
    return String(decoding: try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .fragmentsAllowed]), as: UTF8.self)
}

let acmeDefinitionJSON = #"""
    {"payee":"acme","clearingAccount":"clearing","date":{"start":"2026-11-01","frequency":"monthly","interval":1,
    "patterns":[{"type":"day","value":15},{"type":"day","value":-1}],"endMode":"never"},"weekendSolveMode":"before",
    "grossAmount":300000,"incomeCategory":"income","deductions":[{"id":"tax","name":"Federal tax","amount":60000,"category":"taxes"},
    {"id":"k","name":"401(k)","amount":1000,"transferAccount":"retirement"}],
    "deposits":[{"id":"savings","account":"savings","kind":"percent","value":33.33,"postAutomatically":true,"schedule":"s1"},
    {"id":"checking","account":"checking","kind":"remainder","value":0,"schedule":"s2"}],"paySchedule":"pay"}
    """#

final class PaycheckEditorContractTests: XCTestCase {
    func testDecodesThePreviewFixture() throws {
        let data = try editorFixture("paycheck-preview")
        let preview = try JSONDecoder().decode(PaycheckPreview.self, from: data)
        XCTAssertEqual(preview.netAmount, 240000)
        XCTAssertEqual(preview.payDate, "2026-11-13")
        XCTAssertEqual(preview.employerName, "Acme")
        XCTAssertEqual(preview.deposits.map(\.date), ["2026-11-10", "2026-11-13"])
        XCTAssertEqual(preview.deposits.map(\.calendarName), ["U.S. Federal Holidays", nil])
        XCTAssertEqual(try canonical(JSONEncoder().encode(preview)), try canonical(data))
    }

    func testDecodesTheYearToDateFixture() throws {
        let data = try editorFixture("paycheck-year-to-date")
        let years = try JSONDecoder().decode([PaycheckYearToDate].self, from: data)
        XCTAssertEqual(years.map(\.hasHistory), [false, true])
        XCTAssertEqual(try canonical(JSONEncoder().encode(years)), try canonical(data))
    }

    // The same messages as the web form, through the fixture a vitest test pins
    func testErrorTextMatchesTheWebMessages() throws {
        let web = try JSONDecoder().decode(
            [String: String].self,
            from: Data(contentsOf: packages.appendingPathComponent("desktop-client/src/data/paycheck-error-messages.json")))
        XCTAssertEqual(PaycheckErrorText.messages, web)
        XCTAssertEqual(PaycheckErrorText.message("later-code"), "later-code")
    }

    func testQueriesMatchTheOnesLootCoreRuns() throws {
        let fixture = try JSONSerialization.jsonObject(with: editorFixture("paycheck-editor-queries")) as! [String: Any]
        let encoder = JSONEncoder()
        let ours: [String: PaycheckEditorQuery.Query] = [
            "paycheck": PaycheckEditorQuery.paycheck("PAYCHECK_ID"), "accounts": PaycheckEditorQuery.accounts,
            "payees": PaycheckEditorQuery.payees, "categories": PaycheckEditorQuery.categories,
        ]
        XCTAssertEqual(Set(fixture.keys), Set(ours.keys))
        for (name, query) in ours {
            let theirs = try JSONSerialization.data(withJSONObject: fixture[name]!, options: .sortedKeys)
            // Kept with nulls: `transfer_acct: null` is the filter
            let mine = try JSONSerialization.data(
                withJSONObject: JSONSerialization.jsonObject(with: encoder.encode(query)), options: .sortedKeys)
            XCTAssertEqual(String(decoding: mine, as: UTF8.self), String(decoding: theirs, as: UTF8.self), name)
        }
    }

    func testADefinitionRoundTrips() throws {
        let data = Data(acmeDefinitionJSON.utf8)
        let definition = try JSONDecoder().decode(PaycheckDefinition.self, from: data)
        XCTAssertEqual(definition.deposits.first?.value, 33.33)
        XCTAssertTrue(definition.deductions[1].isTransfer)
        XCTAssertFalse(definition.deductions[0].isTransfer)
        XCTAssertEqual(try canonical(JSONEncoder().encode(definition)), try canonical(data))
    }
}

final class PaycheckEditorWriteTests: XCTestCase {
    private func definition() throws -> PaycheckDefinition {
        try JSONDecoder().decode(PaycheckDefinition.self, from: Data(acmeDefinitionJSON.utf8))
    }

    func testSendsTheSaveAsItsTypedValue() async throws {
        var seen: [(String, String)] = []
        let client = NativeBridgeClient { name, args in
            seen.append((name, args))
            return #""acme""#
        }
        let draft = PaycheckDraft(name: "Acme", definition: try definition(), isNewAccount: false, daysEarly: ["savings": 2])
        let id = try await client.savePaycheck(try PaycheckSave(id: "acme", draft: draft, newClearingAccountName: nil, undoToken: "S"))
        XCTAssertEqual(id, "acme")
        XCTAssertEqual(seen.map(\.0), ["native/paycheck-save"])
        let args = try JSONSerialization.jsonObject(with: Data(seen[0].1.utf8)) as! [String: Any]
        XCTAssertEqual(args["id"] as? String, "acme")
        XCTAssertEqual(args["undoToken"] as? String, "S")
        XCTAssertEqual(args["daysEarly"] as? [String: Int], ["savings": 2])
        XCTAssertNil(args["newClearingAccountName"])
    }

    func testSendsTheDeleteAsItsTypedValue() async throws {
        var seen: [(String, String)] = []
        let client = NativeBridgeClient { name, args in
            seen.append((name, args))
            return "null"
        }
        try await client.deletePaycheck(try PaycheckDelete(id: "acme", undoToken: "D"))
        XCTAssertEqual(seen.map(\.0), ["paycheck-delete"])
        XCTAssertEqual(seen.map(\.1), [#"{"id":"acme","undoToken":"D"}"#])
    }

    func testRefusesInvalidWrites() throws {
        let draft = PaycheckDraft(name: "Acme", definition: try definition(), isNewAccount: false)
        XCTAssertThrowsError(try PaycheckSave(id: "", draft: draft, newClearingAccountName: nil))
        XCTAssertThrowsError(try PaycheckSave(id: nil, draft: draft, newClearingAccountName: nil, undoToken: ""))
        var tooEarly = draft
        tooEarly.daysEarly = ["savings": 11]
        XCTAssertThrowsError(try PaycheckSave(id: nil, draft: tooEarly, newClearingAccountName: nil))
        XCTAssertThrowsError(try PaycheckDelete(id: "", undoToken: "D"))
        XCTAssertThrowsError(try PaycheckDelete(id: "acme", undoToken: ""))
    }

    func testRefusesLooseArgumentsForTheEditorWrites() async {
        var calls = 0
        let client = NativeBridgeClient { _, _ in
            calls += 1
            return "null"
        }
        for name in ["native/paycheck-save", "paycheck-delete"] {
            do {
                _ = try await client.call(name, args: ["id": "acme", "undoToken": "T"])
                XCTFail("expected a refusal")
            } catch {
                XCTAssertEqual(error as? NativeBridgeError, .invalidWrite(name))
            }
        }
        XCTAssertEqual(calls, 0)
    }

    func testReadsYearToDateAndThePreview() async throws {
        var seen: [String] = []
        let preview = String(decoding: try editorFixture("paycheck-preview"), as: UTF8.self)
        let years = String(decoding: try editorFixture("paycheck-year-to-date"), as: UTF8.self)
        let client = NativeBridgeClient { name, args in
            seen.append(name + " " + args)
            return name == "native/paycheck-preview" ? preview : years
        }
        _ = try await client.paycheckYearToDate("acme")
        _ = try await client.paycheckPreview(PaycheckDraft(name: "Acme", definition: try definition(), isNewAccount: false))
        XCTAssertEqual(seen.first, #"paycheck-year-to-date {"id":"acme"}"#)
        XCTAssertTrue(seen.last!.hasPrefix(#"native/paycheck-preview {"daysEarly":{},"definition":"#))
    }
}
