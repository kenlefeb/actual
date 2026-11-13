import Foundation
import XCTest

@testable import NativeBridgeCore

// native-budget-screen spec (sc-3823): the Swift half of the 300-category check.
// Times decoding the `native/budget-month` payload and the view model's load on
// 300 categories, headless (no WKWebView hop, no SwiftUI render). Prints the
// median and p95 on every run; the gate is ADR 11's 50 ms round trip.
private func month300() -> String {
    func category(_ id: String, _ n: Int) -> String {
        #"{"id":"\#(id)","name":"Category \#(id)","hidden":false,"budgeted":\#(1000 * n),"spent":\#(-500 * n),"balance":\#(500 * n),"carryover":false}"#
    }
    let groups = (0..<15).map { g in
        let cats = (1...20).map { category("c\(g)-\($0)", $0) }.joined(separator: ",")
        return #"{"id":"g\#(g)","name":"Group \#(g)","isIncome":false,"hidden":false,"budgeted":210000,"spent":-105000,"balance":105000,"categories":[\#(cats)]}"#
    }.joined(separator: ",")
    return #"""
        {"month":"2026-03","budgetType":"envelope","currencyCode":"USD","currencyDecimalPlaces":2,"currencySymbol":"$",
         "currencySymbolPosition":"before","currencySpace":false,"numberFormat":"comma-dot","hideFraction":false,
         "totals":{"budgeted":3150000,"spent":-1575000,"income":0,"balance":1575000,"toBudget":140000,"available":3290000,
         "lastMonthOverspent":0,"forNextMonth":0,"fromLastMonth":0,"budgetedIncome":null,"saved":null},
         "groups":[\#(groups)]}
        """#
}

private func report(_ label: String, _ times: [Double]) -> BenchmarkStats {
    let stats = BenchmarkStats(timesMs: times)
    print(String(format: "sc-3823 %@: median %.3f ms, p95 %.3f ms (%d runs)", label, stats.medianMs, stats.p95Ms, stats.count))
    return stats
}

private func time(_ runs: Int = 50, _ body: () async throws -> Void) async rethrows -> [Double] {
    var times: [Double] = []
    for _ in 0..<runs {
        let start = DispatchTime.now().uptimeNanoseconds
        try await body()
        times.append(Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000)
    }
    return times
}

@MainActor
final class BudgetPerformanceTests: XCTestCase {
    func testDecodingAndLoadingThreeHundredCategoriesStaysUnderTheGate() async throws {
        let json = month300()
        let data = Data(json.utf8)
        let decoded = try JSONDecoder().decode(BudgetMonth.self, from: data)
        XCTAssertEqual(decoded.groups.reduce(0) { $0 + $1.categories.count }, 300)

        let decode = report("decode \(data.count) bytes", try await time { _ = try JSONDecoder().decode(BudgetMonth.self, from: data) })

        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        let date = DateComponents(calendar: utc, year: 2026, month: 3, day: 9).date!
        let load = report("view model load (fake transport, decode included)", try await time {
            let model = BudgetViewModel(client: NativeBridgeClient { _, _ in json }, now: { date }, calendar: utc)
            await model.load()
            guard case .loaded = model.state else { return XCTFail("expected loaded, got \(model.state)") }
        })

        // Formatting every row's amounts: reported only. The list is lazy, so a screen
        // formats the visible rows, not all 300.
        let style = decoded.amountStyle
        _ = report("format 300 rows x 3 amounts", try await time {
            for group in decoded.expenseGroups {
                for cat in group.visibleCategories {
                    _ = BudgetAmountFormat.string(cat.budgeted, style: style)
                    _ = BudgetAmountFormat.string(cat.spent, style: style)
                    _ = BudgetAmountFormat.string(cat.balance, style: style)
                }
            }
        })

        XCTAssertLessThan(decode.medianMs, 50)
        XCTAssertLessThan(load.medianMs, 50)
    }
}
