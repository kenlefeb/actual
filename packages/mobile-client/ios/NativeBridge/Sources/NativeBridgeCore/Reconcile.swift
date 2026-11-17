import Foundation

// Fork-only (sc-4801, openspec/changes/native-reconcile-flow D5). The native
// reconcile handlers' results and typed writes, as loot-core returns and takes
// them (packages/loot-core/src/server/native/reconcile.ts). Every amount is
// loot-core's, in integer minor units; native code shows them and never works
// out a balance or a difference.
public struct ReconcileMonth: Codable, Equatable {
    // `ready` is reserved for the assistant nudge (D6); a word added later still decodes
    public enum Status: Codable, Equatable {
        case due, inProgress, done, ready
        case other(String)

        static let known: [String: Status] = ["due": .due, "in-progress": .inProgress, "done": .done, "ready": .ready]

        public var rawValue: String {
            if case .other(let word) = self { return word }
            return Self.known.first { $0.value == self }!.key
        }

        public init(from decoder: Decoder) throws {
            let word = try decoder.singleValueContainer().decode(String.self)
            self = Self.known[word] ?? .other(word)
        }

        public func encode(to encoder: Encoder) throws {
            var container = encoder.singleValueContainer()
            try container.encode(rawValue)
        }
    }

    public struct Detail: Codable, Equatable {
        public let cleared: Int
        public let statement: Int?
    }

    public struct Account: Codable, Equatable, Identifiable {
        public let id: String
        public let name: String
        public let status: Status
        public let detail: Detail
        // ms, as the account stores it
        public let lastReconciled: String?
        // The bank sync provider's id, e.g. simpleFin
        public let syncSource: String?

        // As the web dialog names it (statementBalance.ts); an unknown one is unnamed
        public var providerName: String? { syncSource.flatMap { Self.providers[$0] } }

        static let providers = [
            "simpleFin": "SimpleFIN", "goCardless": "GoCardless", "pluggyai": "Pluggy.ai", "enableBanking": "Enable Banking",
            "akahu": "Akahu",
        ]

        enum CodingKeys: String, CodingKey {
            case id, name, status, detail
            case lastReconciled = "last_reconciled"
            case syncSource = "sync_source"
        }
    }

    public let currencyCode: String
    public let currencyDecimalPlaces: Int
    public let currencySymbol: String
    public let currencySymbolPosition: BudgetMonth.SymbolPosition
    public let currencySpace: Bool
    public let numberFormat: BudgetMonth.NumberFormat
    public let hideFraction: Bool
    public struct Hidden: Codable, Equatable, Identifiable {
        public let id: String
        public let name: String
    }

    public let month: String
    public let excluded: [String]
    // The open accounts on the exclusion list, for Edit List to re-add
    public let hidden: [Hidden]
    public let accounts: [Account]

    public var amountStyle: BudgetAmountStyle {
        BudgetAmountStyle(
            currencyCode: currencyCode, currencySymbol: currencySymbol, decimalPlaces: currencyDecimalPlaces,
            symbolPosition: currencySymbolPosition, symbolSpace: currencySpace, numberFormat: numberFormat,
            hideFraction: hideFraction)
    }
}

// `account-statement-balance-prefill` (D2): what step 1 starts with. Swift
// only renders it; loot-core picks the pre-fill and its alternatives.
public struct StatementBalancePrefill: Codable, Equatable {
    public struct Source: Codable, Equatable {
        public let amount: Int
        // bank-sync or cleared; a word added later still decodes
        public let source: String
        public let asOf: String?
        public let link: String?

        enum CodingKeys: String, CodingKey {
            case amount, source, link
            case asOf = "as_of"
        }
    }

    public struct Record: Codable, Equatable {
        public let id: String
        public let amount: Int
        public let source: String
        public let asOf: String?
        public let enteredAt: Double
        // Text from the app: shown as data, never acted on
        public let enteredBy: String
        public let consumedAt: Double?

        enum CodingKeys: String, CodingKey {
            case id, amount, source
            case asOf = "as_of"
            case enteredAt = "entered_at"
            case enteredBy = "entered_by"
            case consumedAt = "consumed_at"
        }
    }

    public let prefill: Source?
    public let alternatives: [Source]
    public let clearedBalance: Int
    public let record: Record?
    public let accountType: String?

    enum CodingKeys: String, CodingKey {
        case prefill, alternatives, record
        case clearedBalance = "cleared_balance"
        case accountType = "account_type"
    }
}

public struct ReconcileSummary: Codable, Equatable {
    // The recorded statement balance; nil without a usable one
    public let statement: Int?
    public let cleared: Int
    public let difference: Int?

    public init(statement: Int?, cleared: Int, difference: Int?) {
        (self.statement, self.cleared, self.difference) = (statement, cleared, difference)
    }
}

public enum ReconcileScope: String, Codable {
    case toTick = "to-tick"
    case all
}

public struct ReconcileRows: Codable, Equatable {
    public struct Row: Codable, Equatable, Identifiable {
        public let id: String
        public let date: String
        public let payee: String?
        public let category: String?
        public let notes: String?
        public let amount: Int
        public let cleared: Bool
        public let reconciled: Bool
        public let isParent: Bool
    }

    public let account: String
    public let scope: ReconcileScope
    public let rows: [Row]
    public let summary: ReconcileSummary
}

// `native/reconcile-tick`: loot-core refuses the whole call unless every id is
// an unreconciled row of the account, and ticks a parent's children with it
public struct ReconcileTick: Encodable, Equatable {
    public let accountId: String
    public let ids: [String]
    public let cleared: Bool
    public let undoToken: String

    static let maxIds = 500

    public init(accountId: String, ids: [String], cleared: Bool, undoToken: String = UUID().uuidString) throws {
        guard !accountId.isEmpty else { throw NativeBridgeError.invalidWrite("account_id") }
        guard !ids.isEmpty, ids.count <= Self.maxIds, !ids.contains("") else { throw NativeBridgeError.invalidWrite("ids") }
        guard !undoToken.isEmpty else { throw NativeBridgeError.invalidWrite("undoToken") }
        (self.accountId, self.ids, self.cleared, self.undoToken) = (accountId, ids, cleared, undoToken)
    }

    enum CodingKeys: String, CodingKey {
        case accountId = "account_id"
        case ids, cleared, undoToken
    }
}

// `native/reconcile-list-set`: the accounts left out of the checklist
public struct ReconcileListSet: Encodable, Equatable {
    public let excluded: [String]

    static let maxExcluded = 500

    public init(excluded: [String]) throws {
        guard excluded.count <= Self.maxExcluded else { throw NativeBridgeError.invalidWrite("excluded") }
        self.excluded = excluded
    }
}

// `account-statement-balance-save`: loot-core derives who and checks the
// source against the data (D3), so this carries neither more nor less
public struct StatementBalanceSave: Encodable, Equatable {
    public enum Source: String, Encodable {
        case bankSync = "bank-sync"
        case cleared, entered
    }

    public let accountId: String
    public let amount: Int
    public let source: Source
    public let asOf: String?

    public init(accountId: String, amount: Int, source: Source, asOf: String?) throws {
        guard !accountId.isEmpty else { throw NativeBridgeError.invalidWrite("account_id") }
        guard amount.magnitude <= 1_000_000_000_000 else { throw NativeBridgeError.invalidWrite("amount") }
        if let asOf, asOf.range(of: #"^[0-9]{4}-[0-9]{2}-[0-9]{2}\z"#, options: .regularExpression) == nil {
            throw NativeBridgeError.invalidWrite("as_of")
        }
        (self.accountId, self.amount, self.source, self.asOf) = (accountId, amount, source, asOf)
    }

    enum CodingKeys: String, CodingKey {
        case accountId = "account_id"
        case amount, source
        case asOf = "as_of"
    }
}

// The page's `presentReconcile` chrome message (D5). The plugin checks the
// origin first (PageOriginGuard); this keeps only an account id that is one
// of the open accounts native read through `native/reconcile-month`, or the
// banner's checklist request. Anything else is ignored.
public enum PresentReconcile: Equatable {
    case account(String)
    case checklist

    public init?(body: Any, openAccounts: Set<String>) {
        guard let body = body as? [String: Any], body["type"] as? String == "presentReconcile" else { return nil }
        if let id = body["account_id"] as? String, openAccounts.contains(id) {
            self = .account(id)
        } else if body["account_id"] == nil, body["checklist"] as? Bool == true {
            self = .checklist
        } else {
            return nil
        }
    }
}

extension NativeBridgeClient {
    public func reconcileMonth() async throws -> ReconcileMonth {
        try JSONDecoder().decode(ReconcileMonth.self, from: await call("native/reconcile-month"))
    }

    public func reconcileRows(accountId: String, scope: ReconcileScope) async throws -> ReconcileRows {
        try JSONDecoder().decode(
            ReconcileRows.self, from: await call("native/reconcile-rows", args: ["account_id": accountId, "scope": scope.rawValue]))
    }

    public func reconcileTick(_ tick: ReconcileTick) async throws -> ReconcileSummary {
        try JSONDecoder().decode(ReconcileSummary.self, from: await call("native/reconcile-tick", args: tick))
    }

    public func setReconcileList(_ list: ReconcileListSet) async throws {
        _ = try await call("native/reconcile-list-set", args: list)
    }

    public func statementBalancePrefill(accountId: String) async throws -> StatementBalancePrefill {
        try JSONDecoder().decode(
            StatementBalancePrefill.self, from: await call("account-statement-balance-prefill", args: ["account_id": accountId]))
    }

    public func saveStatementBalance(_ save: StatementBalanceSave) async throws {
        _ = try await call("account-statement-balance-save", args: save)
    }
}
