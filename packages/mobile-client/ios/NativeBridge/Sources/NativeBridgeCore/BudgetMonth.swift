import Foundation

// Fork-only (sc-3584). The `native/budget-month` result, as loot-core returns
// it (packages/loot-core/src/server/native/app.ts). Amounts are integer cents
// straight from loot-core; native code displays them and never re-sums them.
// nil: the value doesn't apply to this budget type or row.
public struct BudgetMonth: Codable, Equatable {
    public enum BudgetType: String, Codable { case envelope, tracking }

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
    }

    public let month: String
    public let budgetType: BudgetType
    public let totals: Totals
    public let groups: [Group]
}
