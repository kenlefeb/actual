import XCTest

@testable import NativeBridgeCore

// Fork-only (sc-3814, native-budget-screen spec: VoiceOver on a category). What
// VoiceOver speaks for a category or group row: each amount with its column
// name, in the budget's own format, and the word "Overspent" for a negative
// balance (never colour alone).
final class BudgetSpeechTests: XCTestCase {
    private let style = BudgetAmountStyle(
        currencyCode: "USD", currencySymbol: "$", decimalPlaces: 2, symbolPosition: .before, symbolSpace: false,
        numberFormat: .commaDot, hideFraction: false)

    func testExpenseRowSpeaksBudgetedSpentAndBalance() {
        XCTAssertEqual(
            BudgetSpeech.value(budgeted: 50000, spent: -12050, balance: 37950, isIncome: false, style: style),
            "Budgeted $500.00, Spent -$120.50, Balance $379.50")
    }

    func testNegativeBalanceIsSpokenAsOverspent() {
        XCTAssertEqual(
            BudgetSpeech.value(budgeted: 1000, spent: -2500, balance: -1500, isIncome: false, style: style),
            "Budgeted $10.00, Spent -$25.00, Balance -$15.00, Overspent")
    }

    func testIncomeRowSpeaksReceivedAndSkipsAmountsItDoesNotHave() {
        XCTAssertEqual(
            BudgetSpeech.value(budgeted: nil, spent: 300000, balance: nil, isIncome: true, style: style),
            "Received $3,000.00")
    }

    func testRowWithNoAmountsSpeaksNothing() {
        XCTAssertEqual(BudgetSpeech.value(budgeted: nil, spent: nil, balance: nil, isIncome: false, style: style), "")
    }
}
