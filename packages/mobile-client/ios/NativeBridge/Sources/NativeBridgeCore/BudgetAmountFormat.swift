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

    private static func separators(_ style: BudgetAmountStyle) -> (grouping: [Character], decimal: Character) {
        switch style.numberFormat {
        case .commaDot, .commaDotIn: return ([","], ".")
        case .dotComma: return (["."], ",")
        case .spaceComma: return ([" ", "\u{202F}", "\u{00A0}"], ",")
        case .apostropheDot: return (["'", "\u{2019}"], ".")
        }
    }

    // The edit field's input to loot-core minor units, using the budget's own
    // separators and decimal places (never the device locale). nil: not an
    // amount this budget can hold, so it is never sent.
    public static func minorUnits(from text: String, style: BudgetAmountStyle) -> Int? {
        let (grouping, decimal) = separators(style)
        var rest = Substring(text.trimmingCharacters(in: .whitespacesAndNewlines))
        if !style.currencySymbol.isEmpty { rest = Substring(rest.replacingOccurrences(of: style.currencySymbol, with: "")) }
        let negative = rest.hasPrefix("-")
        if negative { rest.removeFirst() }
        let parts = rest.split(separator: decimal, maxSplits: 1, omittingEmptySubsequences: false)
        guard let grouped = parts.first, parts.count <= (style.decimalPlaces > 0 ? 2 : 1) else { return nil }
        // A grouping separator must close a three-digit group, so "12,50" is
        // refused, not read as 1,250 (the web reads it as 12.50)
        let groups = grouped.split(omittingEmptySubsequences: false) { grouping.contains($0) }
        guard groups.count == 1 || (groups.allSatisfy { !$0.isEmpty } && groups.last?.count == 3) else { return nil }
        let whole = groups.joined()
        let fraction = parts.count == 2 ? parts[1] : ""
        guard whole.count + fraction.count > 0, whole.count <= 15, fraction.count <= style.decimalPlaces,
            (whole + fraction).allSatisfy({ $0.isASCII && $0.isNumber })
        else { return nil }
        let digits = whole + fraction + String(repeating: "0", count: style.decimalPlaces - fraction.count)
        guard let value = Int(digits) else { return nil }
        return negative ? -value : value
    }

    // The amount as the edit field first shows it: no symbol or grouping
    public static func editString(_ minorUnits: Int, style: BudgetAmountStyle) -> String {
        let places = style.decimalPlaces
        let digits = String(abs(minorUnits))
        let padded = String(repeating: "0", count: max(0, places + 1 - digits.count)) + digits
        let split = padded.index(padded.endIndex, offsetBy: -places)
        let fraction = places > 0 ? String(separators(style).decimal) + padded[split...] : ""
        return (minorUnits < 0 ? "-" : "") + padded[..<split] + fraction
    }

    public static func tone(_ minorUnits: Int?) -> Tone {
        guard let minorUnits, minorUnits != 0 else { return .zero }
        return minorUnits < 0 ? .negative : .positive
    }
}

// Fork-only (sc-3814). What VoiceOver speaks for a category or group row: each
// amount that applies, named by its column, and the word "Overspent" for a
// negative balance so colour is never the only signal.
public enum BudgetSpeech {
    public static func value(budgeted: Int?, spent: Int?, balance: Int?, isIncome: Bool, style: BudgetAmountStyle) -> String {
        let spentTitle =
            isIncome
            ? NSLocalizedString("Received", comment: "Native Budget tab: income column")
            : NSLocalizedString("Spent", comment: "Native Budget tab column")
        var parts = [
            (NSLocalizedString("Budgeted", comment: "Native Budget tab column"), budgeted), (spentTitle, spent),
            (NSLocalizedString("Balance", comment: "Native Budget tab column"), balance),
        ]
        .compactMap { title, amount in amount.map { "\(title) \(BudgetAmountFormat.string($0, style: style))" } }
        if let balance, balance < 0 { parts.append(NSLocalizedString("Overspent", comment: "Native Budget tab: a negative balance")) }
        return parts.joined(separator: ", ")
    }
}
