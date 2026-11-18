import Foundation

// Fork-only (sc-4386, openspec/changes/native-accounts-screen D1 and D2). The
// native Accounts screen's two reads, as loot-core returns them
// (packages/loot-core/src/server/native/accounts.ts). Every balance, total and
// running balance is loot-core's, in integer minor units; native code shows
// them and never adds anything up.
public struct AccountsList: Codable, Equatable {
    public struct Account: Codable, Equatable, Identifiable {
        public let id: String
        public let name: String
        public let balance: Int
        public let offbudget: Bool
        public let closed: Bool
        // ms, as the account stores it
        public let lastSync: String?
        // yyyy-MM-dd
        public let lastTransactionDate: String?
        // Linked to a bank
        public let bankSync: Bool
        // The paycheck's name when this is its clearing account
        public let clearingFor: String?
    }

    public struct Section: Codable, Equatable {
        public let total: Int
        public let accounts: [Account]
    }

    public struct Sections: Codable, Equatable {
        public let onBudget: Section
        public let offBudget: Section
    }

    public let currencyCode: String
    public let currencyDecimalPlaces: Int
    public let currencySymbol: String
    public let currencySymbolPosition: BudgetMonth.SymbolPosition
    public let currencySpace: Bool
    public let numberFormat: BudgetMonth.NumberFormat
    public let hideFraction: Bool
    public let sections: Sections
    public let closed: Section
    // The open accounts' sum
    public let netWorth: Int
}

public enum AccountRegisterScope: String, Codable {
    case all, uncleared, uncategorized
}

public struct AccountRegister: Codable, Equatable {
    public struct TransferAccount: Codable, Equatable {
        public let id: String
        public let name: String
    }

    public struct Row: Codable, Equatable, Identifiable {
        public let id: String
        // yyyy-MM-dd
        public let date: String
        public let payee: String?
        public let category: String?
        public let splitCount: Int
        public let notes: String?
        public let amount: Int
        public let cleared: Bool
        public let reconciled: Bool
        // A transfer's other account, and whether its row is reconciled
        public let transferAccount: TransferAccount?
        public let transferReconciled: Bool?
        // Only for scope all, with no search, while the account shows balances
        public let runningBalance: Int?
    }

    public struct Header: Codable, Equatable {
        public let balance: Int
        public let cleared: Int
        public let uncleared: Int
    }

    public struct Upcoming: Codable, Equatable, Identifiable {
        public let id: String
        public let scheduleId: String
        public let date: String
        public let payee: String?
        public let amount: Int
    }

    public let currencyCode: String
    public let currencyDecimalPlaces: Int
    public let currencySymbol: String
    public let currencySymbolPosition: BudgetMonth.SymbolPosition
    public let currencySpace: Bool
    public let numberFormat: BudgetMonth.NumberFormat
    public let hideFraction: Bool
    public let rows: [Row]
    // Opaque: handed back as is; nil after the last page
    public let nextCursor: String?
    // The first page only
    public let header: Header?
    public let upcoming: [Upcoming]?
}

// `native/account-register`'s arguments. Swift sends no page size: loot-core
// reads the synced `accounts-register-page-size` preference.
public struct AccountRegisterRequest: Encodable, Equatable {
    public let accountId: String
    public let scope: AccountRegisterScope
    public let search: String?
    public let cursor: String?

    static let maxSearch = 100

    public init(accountId: String, scope: AccountRegisterScope = .all, search: String? = nil, cursor: String? = nil) throws {
        guard !accountId.isEmpty else { throw NativeBridgeError.invalidWrite("account_id") }
        guard (search?.count ?? 0) <= Self.maxSearch else { throw NativeBridgeError.invalidWrite("search") }
        (self.accountId, self.scope, self.search, self.cursor) = (accountId, scope, search, cursor)
    }

    enum CodingKeys: String, CodingKey {
        case accountId = "account_id"
        case scope, search, cursor
    }
}

extension NativeBridgeClient {
    public func accountsList() async throws -> AccountsList {
        try JSONDecoder().decode(AccountsList.self, from: await call("native/accounts-list"))
    }

    public func accountRegister(_ request: AccountRegisterRequest) async throws -> AccountRegister {
        try JSONDecoder().decode(AccountRegister.self, from: await call("native/account-register", args: request))
    }
}
