import Foundation
import XCTest

@testable import NativeBridgeCore

// PR 366 UX review: the editor words read-only pay-date settings as the web
// schedule editor does, never as raw codes
final class PaycheckDateTextTests: XCTestCase {
    private let us = Locale(identifier: "en_US")

    func testWordsAWeekdayPatternLikeTheWeb() {
        XCTAssertEqual(PaycheckDateText.pattern(.init(value: -1, type: "FR"), locale: us), "Also paid: last Friday")
        XCTAssertEqual(PaycheckDateText.pattern(.init(value: 2, type: "TU"), locale: us), "Also paid: 2nd Tuesday")
        XCTAssertEqual(PaycheckDateText.pattern(.init(value: 1, type: "SU"), locale: us), "Also paid: 1st Sunday")
        XCTAssertNil(PaycheckDateText.pattern(.init(value: 15, type: "day"), locale: us))
    }

    private func config(_ endMode: String?, occurrences: Int? = nil, date: String? = nil) -> PaycheckDefinition.RecurConfig {
        PaycheckDefinition.RecurConfig(
            frequency: "monthly", interval: 1, patterns: nil, start: "2026-11-01", endMode: endMode, endOccurrences: occurrences,
            endDate: date)
    }

    func testWordsTheEnd() {
        XCTAssertEqual(PaycheckDateText.end(config("on_date", date: "2027-12-31"), locale: us), "Ends on Dec 31, 2027")
        XCTAssertEqual(PaycheckDateText.end(config("after_n_occurrences", occurrences: 26), locale: us), "Ends after 26 paychecks")
        XCTAssertEqual(PaycheckDateText.end(config("after_n_occurrences", occurrences: 1), locale: us), "Ends after 1 paycheck")
        XCTAssertNil(PaycheckDateText.end(config("never"), locale: us))
        XCTAssertNil(PaycheckDateText.end(config(nil), locale: us))
    }

    // DESIGN.native.md: money in always carries its "+"
    func testIncomingMoneyHasItsSign() throws {
        let style = try JSONDecoder().decode(SchedulesPaychecks.self, from: paychecksFixture()).amountStyle
        XCTAssertEqual(PaycheckDateText.incoming(225000, style: style), "+2,250.00")
        XCTAssertEqual(PaycheckDateText.incoming(0, style: style), "0.00")
        XCTAssertEqual(PaycheckDateText.incoming(-100, style: style), "-1.00")
    }
}

final class PaycheckDraftEncodingTests: XCTestCase {
    // A cleared category or a switch back from a transfer must reach loot-core
    // as null: the save merges the draft onto the stored definition
    func testADeductionSendsItsClearedFieldsAsNull() throws {
        let deduction = PaycheckDefinition.Deduction(id: "t", name: "Tax", amount: 1, category: nil, transferAccount: nil)
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(deduction)) as! [String: Any]
        XCTAssertTrue(json["category"] is NSNull)
        XCTAssertTrue(json["transferAccount"] is NSNull)
    }

    // The preview shows an unedited paycheck's stored next date
    func testTheDraftNamesThePaycheckItEdits() throws {
        let definition = try JSONDecoder().decode(PaycheckDefinition.self, from: Data(acmeDefinitionJSON.utf8))
        let draft = PaycheckDraft(id: "acme", name: "Acme", definition: definition, isNewAccount: false)
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(draft)) as! [String: Any]
        XCTAssertEqual(json["id"] as? String, "acme")
        let new = PaycheckDraft(name: "Acme", definition: definition, isNewAccount: true)
        XCTAssertNil((try JSONSerialization.jsonObject(with: JSONEncoder().encode(new)) as! [String: Any])["id"])
    }
}
