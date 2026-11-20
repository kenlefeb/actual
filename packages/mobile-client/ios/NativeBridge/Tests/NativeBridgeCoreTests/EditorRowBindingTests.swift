import XCTest

@testable import NativeBridgeCore

// sc-5504: a row's field binding outlives the row for one render after the
// row's Remove. Indexing the array by the captured position then trapped
// (TestFlight crash: removing a deduction). Rows are read and written by id.
final class EditorRowBindingTests: XCTestCase {
    private func deductions() -> [PaycheckDefinition.Deduction] {
        [
            .init(id: "a", name: "Health", amount: 100, category: nil),
            .init(id: "b", name: "401k", amount: 200, category: nil),
        ]
    }

    func testReadingARemovedRowGivesTheFallbackInsteadOfTrapping() {
        var rows = deductions()
        rows.remove(at: 1)
        XCTAssertEqual(rows.read("b", \.name, fallback: "401k"), "401k")
        XCTAssertEqual(rows.read("a", \.name, fallback: ""), "Health")
    }

    func testWritingARemovedRowChangesNothing() {
        var rows = deductions()
        rows.remove(at: 0)
        rows.write("a", \.name, "late write")
        XCTAssertEqual(rows.map(\.name), ["401k"])
    }

    func testWritingFollowsTheRowAfterAnEarlierRowIsRemoved() {
        var rows = deductions()
        rows.remove(at: 0)
        rows.write("b", \.amount, 300)
        XCTAssertEqual(rows.map(\.amount), [300])
    }

    func testWritingAMissingIdIsANoOp() {
        var rows = deductions()
        rows.write("nope", \.name, "x")
        XCTAssertEqual(rows.map(\.name), ["Health", "401k"])
    }

    func testRemovingByIdRemovesTheRightRowAndALaterWriteFollowsTheRowById() {
        var rows = deductions()
        rows.remove(id: "a")
        XCTAssertEqual(rows.map(\.id), ["b"])
        rows.write("b", \.name, "Retirement")
        XCTAssertEqual(rows.map(\.name), ["Retirement"])
        // A second Remove of a row that is already gone changes nothing
        rows.remove(id: "a")
        XCTAssertEqual(rows.map(\.id), ["b"])
    }
}
