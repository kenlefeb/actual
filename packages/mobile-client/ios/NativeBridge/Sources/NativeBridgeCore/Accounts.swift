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

// sc-4931 (native-accounts-screen D3): the four Accounts writes. Each is sent
// only as its own typed value with the undo token Swift makes; loot-core
// validates the whole call and nothing changes on a refusal. Swift never
// writes the database. 500 is the engine's ceiling for `accounts-write-max-ids`;
// the setting itself (default 100) is applied there.
private func requireValue(_ value: String, _ field: String) throws {
    guard !value.isEmpty else { throw NativeBridgeError.invalidWrite(field) }
}

// `native/transactions-categorize`: `category` nil clears it and is sent as null
public struct TransactionsCategorize: Encodable, Equatable {
    public let accountId: String
    public let ids: [String]
    public let category: String?
    // True only after the person confirmed changing a reconciled row
    public let confirmedReconciled: Bool
    public let undoToken: String

    static let maxIds = 500

    public init(accountId: String, ids: [String], category: String?, confirmedReconciled: Bool = false, undoToken: String = UUID().uuidString) throws {
        try requireValue(accountId, "account_id")
        guard !ids.isEmpty, ids.count <= Self.maxIds, !ids.contains("") else { throw NativeBridgeError.invalidWrite("ids") }
        guard category != "" else { throw NativeBridgeError.invalidWrite("category") }
        try requireValue(undoToken, "undoToken")
        (self.accountId, self.ids, self.category, self.confirmedReconciled, self.undoToken) =
            (accountId, ids, category, confirmedReconciled, undoToken)
    }

    enum CodingKeys: String, CodingKey {
        case accountId = "account_id"
        case ids, category, confirmedReconciled, undoToken
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(accountId, forKey: .accountId)
        try container.encode(ids, forKey: .ids)
        try container.encode(category, forKey: .category)
        try container.encode(confirmedReconciled, forKey: .confirmedReconciled)
        try container.encode(undoToken, forKey: .undoToken)
    }
}

// `native/transactions-delete`: a transfer's partner and a split's children go with it
public struct TransactionsDelete: Encodable, Equatable {
    public let accountId: String
    public let ids: [String]
    public let confirmedReconciled: Bool
    public let undoToken: String

    static let maxIds = 500

    public init(accountId: String, ids: [String], confirmedReconciled: Bool = false, undoToken: String = UUID().uuidString) throws {
        try requireValue(accountId, "account_id")
        guard !ids.isEmpty, ids.count <= Self.maxIds, !ids.contains("") else { throw NativeBridgeError.invalidWrite("ids") }
        try requireValue(undoToken, "undoToken")
        (self.accountId, self.ids, self.confirmedReconciled, self.undoToken) = (accountId, ids, confirmedReconciled, undoToken)
    }

    enum CodingKeys: String, CodingKey {
        case accountId = "account_id"
        case ids, confirmedReconciled, undoToken
    }
}

// `native/account-reopen`: only a closed account
public struct AccountReopen: Encodable, Equatable {
    public let id: String
    public let undoToken: String

    public init(id: String, undoToken: String = UUID().uuidString) throws {
        try requireValue(id, "id")
        try requireValue(undoToken, "undoToken")
        (self.id, self.undoToken) = (id, undoToken)
    }
}

// `native/account-move`: before `targetId` in the same section, or to the end
// of it when nil (sent as null)
public struct AccountMove: Encodable, Equatable {
    public let id: String
    public let targetId: String?
    public let undoToken: String

    public init(id: String, targetId: String?, undoToken: String = UUID().uuidString) throws {
        try requireValue(id, "id")
        if let targetId {
            try requireValue(targetId, "targetId")
            guard targetId != id else { throw NativeBridgeError.invalidWrite("targetId") }
        }
        try requireValue(undoToken, "undoToken")
        (self.id, self.targetId, self.undoToken) = (id, targetId, undoToken)
    }

    enum CodingKeys: String, CodingKey { case id, targetId, undoToken }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(targetId, forKey: .targetId)
        try container.encode(undoToken, forKey: .undoToken)
    }
}

extension NativeBridgeClient {
    public func categorizeTransactions(_ write: TransactionsCategorize) async throws {
        _ = try await call("native/transactions-categorize", args: write)
    }

    public func deleteTransactions(_ write: TransactionsDelete) async throws {
        _ = try await call("native/transactions-delete", args: write)
    }

    public func reopenAccount(_ write: AccountReopen) async throws {
        _ = try await call("native/account-reopen", args: write)
    }

    public func moveAccount(_ write: AccountMove) async throws {
        _ = try await call("native/account-move", args: write)
    }
}
