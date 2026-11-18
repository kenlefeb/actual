import Foundation
import XCTest

@testable import NativeBridgeCore

// sc-3611 (native-bridge: "Native refusals carry a stable code"). Swift branches
// on the `[native:<code>]` token loot-core puts first, never on the words after
// it; the code list is the contract fixture loot-core and the page test too.
private let fixturesDir = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("loot-core/src/server/native/fixtures")

@MainActor
final class NativeRefusalTests: XCTestCase {
    func testTheCodesAreTheContractFixture() throws {
        let data = try Data(contentsOf: fixturesDir.appendingPathComponent("native-refusal-codes.json"))
        let codes = try JSONDecoder().decode([String].self, from: data)
        XCTAssertEqual(NativeRefusal.Code.allCases.map(\.rawValue), codes)
    }

    func testEachCodeIsReadFromTheToken() {
        for code in NativeRefusal.Code.allCases {
            XCTAssertEqual(NativeRefusal("[native:\(code.rawValue)] any words")?.code, code)
        }
        XCTAssertEqual(
            NativeRefusal("[native:invalid-draft:name-missing,no-deposits] words"),
            NativeRefusal(code: .invalidDraft, detail: ["name-missing", "no-deposits"]))
    }

    // An unknown code, a token not first, or wording alone: no code, so the generic message
    func testOnlyAKnownLeadingTokenCounts() {
        XCTAssertNil(NativeRefusal("[native:something-new] words"))
        XCTAssertNil(NativeRefusal("native/undo: changed since, can't undo"))
        XCTAssertNil(NativeRefusal("prefix [native:undo-nothing] words"))
        XCTAssertNil(NativeRefusal("[native:undo-nothing"))
    }

    func testTheWritesMapEachCodeAndFallBackOnAnUnknownOne() {
        XCTAssertEqual(AccountsWrites.undoError(NativeBridgeError.page("[native:undo-changed-since] x")), .changedSince)
        XCTAssertEqual(AccountsWrites.undoError(NativeBridgeError.page("[native:undo-nothing] x")), .nothingToUndo)
        XCTAssertEqual(AccountsWrites.undoError(NativeBridgeError.page("[native:something-new] x")), .undoFailed)
        // The words alone no longer count
        XCTAssertEqual(AccountsWrites.undoError(NativeBridgeError.page("native/undo: changed since, can't undo")), .undoFailed)
        XCTAssertEqual(
            AccountsWrites.writeError(NativeBridgeError.page("[native:needs-confirmed-reconciled] x"), otherwise: .deleteFailed),
            .needsConfirmation)
        XCTAssertEqual(
            AccountsWrites.writeError(NativeBridgeError.page("a reconciled row needs confirmedReconciled"), otherwise: .deleteFailed),
            .deleteFailed)
    }

    func testTheBudgetAndPaycheckScreensMapTheirCodes() {
        XCTAssertEqual(BudgetLoadError.from(NativeBridgeError.page("[native:no-budget-for-month] x")), .noBudgetForMonth)
        XCTAssertEqual(BudgetLoadError.from(NativeBridgeError.page("native/budget-month: no budget for month 2026-03")), .other)
        XCTAssertEqual(
            PaycheckEditorViewModel.message(for: NativeBridgeError.page("[native:invalid-draft:name-missing] x")),
            PaycheckErrorText.message("name-missing"))
        // A coded refusal Swift has no words for is never shown as it is
        XCTAssertEqual(
            PaycheckEditorViewModel.message(for: NativeBridgeError.page("[native:something-new] native/x: detail")),
            PaycheckEditorViewModel.failed)
    }
}
