import Foundation

// Fork-only (sc-3751). How to show a loot-core amount, taken from the month
// snapshot, which carries the web's own formatting preferences (useFormat.ts).
// Not the device locale: native amounts must read like the web's.
public struct BudgetAmountStyle: Equatable {
    public let currencyCode: String
    public let currencySymbol: String
    public let decimalPlaces: Int
    public let symbolPosition: BudgetMonth.SymbolPosition
    public let symbolSpace: Bool
    public let numberFormat: BudgetMonth.NumberFormat
    public let hideFraction: Bool

    public init(
        currencyCode: String, currencySymbol: String, decimalPlaces: Int, symbolPosition: BudgetMonth.SymbolPosition,
        symbolSpace: Bool, numberFormat: BudgetMonth.NumberFormat, hideFraction: Bool
    ) {
        self.currencyCode = currencyCode
        self.currencySymbol = currencySymbol
        self.decimalPlaces = decimalPlaces
        self.symbolPosition = symbolPosition
        self.symbolSpace = symbolSpace
        self.numberFormat = numberFormat
        self.hideFraction = hideFraction
    }
}

// Display only: loot-core amounts are integer minor units; this puts the
// decimal point and the symbol where the web does.
public enum BudgetAmountFormat {
    public enum Tone: Equatable { case positive, negative, zero }

    // nil: the value does not apply to this budget type or row
    public static func string(_ minorUnits: Int?, style: BudgetAmountStyle) -> String {
        guard let minorUnits else { return "" }
        let places = style.hideFraction ? 0 : style.decimalPlaces
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.numberStyle = .decimal
        formatter.roundingMode = .halfUp
        formatter.minimumFractionDigits = places
        formatter.maximumFractionDigits = places
        formatter.usesGroupingSeparator = true
        formatter.groupingSize = 3
        switch style.numberFormat {
        case .commaDot: break
        case .dotComma: (formatter.groupingSeparator, formatter.decimalSeparator) = (".", ",")
        case .spaceComma: (formatter.groupingSeparator, formatter.decimalSeparator) = ("\u{202F}", ",")
        case .apostropheDot: formatter.groupingSeparator = "\u{2019}"
        case .commaDotIn: formatter.secondaryGroupingSize = 2
        }
        let value = Decimal(minorUnits) / pow(10, style.decimalPlaces)
        var text = formatter.string(from: value as NSDecimalNumber) ?? ""
        var sign = ""
        if text.hasPrefix("-") {
            text.removeFirst()
            // Like the web, "-0" is "0"
            if text.contains(where: { $0.isNumber && $0 != "0" }) { sign = "-" }
        }
        guard !style.currencyCode.isEmpty, !style.currencySymbol.isEmpty else { return sign + text }
        let space = style.symbolSpace ? "\u{202F}" : ""
        switch style.symbolPosition {
        case .after: return sign + text + space + style.currencySymbol
        case .before: return sign + style.currencySymbol + space + text
        }
    }

    public static func tone(_ minorUnits: Int?) -> Tone {
        guard let minorUnits, minorUnits != 0 else { return .zero }
        return minorUnits < 0 ? .negative : .positive
    }
}
