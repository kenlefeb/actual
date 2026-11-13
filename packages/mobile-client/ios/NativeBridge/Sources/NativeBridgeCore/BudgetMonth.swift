import Foundation

// Fork-only (sc-3584). The `native/budget-month` result, as loot-core returns
// it (packages/loot-core/src/server/native/app.ts). Amounts are integer cents
// straight from loot-core; native code displays them and never re-sums them.
// nil: the value doesn't apply to this budget type or row.
public struct BudgetMonth: Codable, Equatable {
    public enum BudgetType: String, Codable { case envelope, tracking }

    public enum SymbolPosition: String, Codable { case before, after }
    public enum NumberFormat: String, Codable {
        case commaDot = "comma-dot"
        case dotComma = "dot-comma"
        case spaceComma = "space-comma"
        case apostropheDot = "apostrophe-dot"
        case commaDotIn = "comma-dot-in"
    }

    public struct Totals: Codable, Equatable {
        public let budgeted: Int?
        public let spent: Int?
        public let income: Int?
        public let balance: Int?
        public let toBudget: Int?
        public let available: Int?
        public let lastMonthOverspent: Int?
        public let forNextMonth: Int?
        public let fromLastMonth: Int?
        public let budgetedIncome: Int?
        public let saved: Int?
    }

    public struct Category: Codable, Equatable, Identifiable {
        public let id: String
        public let name: String
        public let hidden: Bool
        public let budgeted: Int?
        public let spent: Int?
        public let balance: Int?
        public let carryover: Bool
    }

    public struct Group: Codable, Equatable, Identifiable {
        public let id: String
        public let name: String
        public let isIncome: Bool
        public let hidden: Bool
        public let budgeted: Int?
        public let spent: Int?
        public let balance: Int?
        public let categories: [Category]

        public var visibleCategories: [Category] { categories.filter { !$0.hidden } }
    }

    public let month: String
    // The budget's first and last month (sc-3850). nil from a server that
    // predates them, or when loot-core holds no months.
    public let firstMonth: String?
    public let lastMonth: String?
    public let budgetType: BudgetType
    // How the web formats money, as loot-core resolved it (useFormat.ts): the
    // currency ('' is none) and the formatting preferences
    public let currencyCode: String
    public let currencyDecimalPlaces: Int
    public let currencySymbol: String
    public let currencySymbolPosition: SymbolPosition
    public let currencySpace: Bool
    public let numberFormat: NumberFormat
    public let hideFraction: Bool
    public let totals: Totals
    public let groups: [Group]

    public var amountStyle: BudgetAmountStyle {
        BudgetAmountStyle(
            currencyCode: currencyCode, currencySymbol: currencySymbol, decimalPlaces: currencyDecimalPlaces,
            symbolPosition: currencySymbolPosition, symbolSpace: currencySpace, numberFormat: numberFormat,
            hideFraction: hideFraction)
    }

    // Income is shown apart from the expense groups; hidden groups are left out
    public var expenseGroups: [Group] { groups.filter { !$0.hidden && !$0.isIncome } }
    public var incomeGroups: [Group] { groups.filter { !$0.hidden && $0.isIncome } }

    // Groups whose categories take a budgeted amount through `budget/budget-amount`.
    // A tracking budget holds budgeted income; an envelope budget does not (sc-3778).
    // The page bridge applies the same rule (nativeBridge.ts).
    public var editableGroups: [Group] { budgetType == .tracking ? groups.filter { !$0.hidden } : expenseGroups }
}
