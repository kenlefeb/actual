import Foundation

// Fork-only (sc-3751). Display only: loot-core amounts are integer minor
// units; this puts the decimal point where the budget's currency says.
public enum BudgetAmountFormat {
    // nil: the value does not apply to this budget type or row
    public static func string(_ minorUnits: Int?, decimalPlaces: Int, currencyCode: String, locale: Locale = .current) -> String {
        guard let minorUnits else { return "" }
        let formatter = NumberFormatter()
        formatter.locale = locale
        if currencyCode.isEmpty {
            formatter.numberStyle = .decimal
        } else {
            formatter.numberStyle = .currency
            formatter.currencyCode = currencyCode
        }
        formatter.minimumFractionDigits = decimalPlaces
        formatter.maximumFractionDigits = decimalPlaces
        let value = Decimal(minorUnits) / pow(10, decimalPlaces)
        return formatter.string(from: value as NSDecimalNumber) ?? ""
    }
}
