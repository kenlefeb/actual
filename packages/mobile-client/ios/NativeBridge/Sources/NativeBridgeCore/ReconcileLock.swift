import Foundation

// Fork-only (sc-4825, openspec/changes/native-reconcile-resolve-and-lock).
// Reconcile steps 3 and 4 as loot-core returns and takes them
// (packages/loot-core/src/server/native/reconcile-lock.ts). Native code shows
// these amounts and works none out.

// `native/reconcile-matches` (D2)
public struct ReconcileMatches: Codable, Equatable {
    public struct Match: Codable, Equatable {
        public enum Kind: Codable, Equatable {
            case tickOne, tickTwo, untickOne
            case other(String)

            static let known: [String: Kind] = ["tick-one": .tickOne, "tick-two": .tickTwo, "untick-one": .untickOne]

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

        public let kind: Kind
        public let ids: [String]
        public let amounts: [Int]
    }

    public let difference: Int?
    public let matches: [Match]
    // The add form's decimal `amount` (the form negates it); nil at zero
    public let addAmountParam: String?

    enum CodingKeys: String, CodingKey {
        case difference, matches
        case addAmountParam = "add_amount_param"
    }
}

// `native/reconcile-lock-preview` (D3)
public struct ReconcileLockPreview: Codable, Equatable {
    public struct Partner: Codable, Equatable, Identifiable {
        public let id: String
        public let account: String?
        public let amount: Int
        public let date: String
        public let reconciled: Bool
    }

    public struct Record: Codable, Equatable {
        public let amount: Int
        public let source: String
        public let enteredAt: Double

        enum CodingKeys: String, CodingKey {
            case amount, source
            case enteredAt = "entered_at"
        }
    }

    public let rows: [ReconcileRows.Row]
    public let count: Int
    public let childCount: Int
    public let truncated: Bool
    public let partners: [Partner]
    public let skippedChildren: [String]
    public let record: Record?
    public let planDigest: String

    enum CodingKeys: String, CodingKey {
        case rows, count, truncated, partners, record
        case childCount = "child_count"
        case skippedChildren = "skipped_children"
        case planDigest = "plan_digest"
    }
}

// `native/reconcile-adjust` (D4): a person's confirmed adjustment
public struct ReconcileAdjust: Encodable, Equatable {
    public let accountId: String
    public let amount: Int
    public let categoryId: String?
    public let label: String
    public let undoToken: String

    public init(accountId: String, amount: Int, categoryId: String?, label: String, undoToken: String = UUID().uuidString) throws {
        guard !accountId.isEmpty else { throw NativeBridgeError.invalidWrite("account_id") }
        guard amount != 0, amount.magnitude <= BudgetAmountWrite.maxAmount else { throw NativeBridgeError.invalidWrite("amount") }
        guard (1...100).contains(label.count) else { throw NativeBridgeError.invalidWrite("label") }
        guard categoryId?.isEmpty != true else { throw NativeBridgeError.invalidWrite("category_id") }
        guard !undoToken.isEmpty else { throw NativeBridgeError.invalidWrite("undoToken") }
        (self.accountId, self.amount, self.categoryId, self.label, self.undoToken) = (accountId, amount, categoryId, label, undoToken)
    }

    enum CodingKeys: String, CodingKey {
        case accountId = "account_id"
        case categoryId = "category_id"
        case amount, label, undoToken
    }
}

public struct ReconcileAdjustResult: Codable, Equatable {
    public let id: String
    public let summary: ReconcileSummary
}

// `native/reconcile-lock` (D5): bound to the preview's digest, never undone through the bridge
public struct ReconcileLock: Encodable, Equatable {
    public let accountId: String
    public let planDigest: String

    public init(accountId: String, planDigest: String) throws {
        guard !accountId.isEmpty else { throw NativeBridgeError.invalidWrite("account_id") }
        guard !planDigest.isEmpty else { throw NativeBridgeError.invalidWrite("plan_digest") }
        (self.accountId, self.planDigest) = (accountId, planDigest)
    }

    enum CodingKeys: String, CodingKey {
        case accountId = "account_id"
        case planDigest = "plan_digest"
    }
}

public struct ReconcileLockResult: Codable, Equatable {
    public let lockedIds: [String]
    public let linkedIds: [String]
    // false: the rows locked but the balance moved while locking
    public let verified: Bool
    public let cleared: Int
    public let difference: Int

    enum CodingKeys: String, CodingKey {
        case lockedIds = "locked_ids"
        case linkedIds = "linked_ids"
        case verified, cleared, difference
    }
}

extension NativeBridgeClient {
    public func reconcileMatches(accountId: String) async throws -> ReconcileMatches {
        try JSONDecoder().decode(ReconcileMatches.self, from: await call("native/reconcile-matches", args: ["account_id": accountId]))
    }

    public func reconcileSearch(accountId: String, text: String) async throws -> ReconcileRows {
        try JSONDecoder().decode(
            ReconcileRows.self,
            from: await call("native/reconcile-rows", args: ["account_id": accountId, "scope": ReconcileScope.all.rawValue, "search": text]))
    }

    public func reconcileLockPreview(accountId: String) async throws -> ReconcileLockPreview {
        try JSONDecoder().decode(
            ReconcileLockPreview.self, from: await call("native/reconcile-lock-preview", args: ["account_id": accountId]))
    }

    public func reconcileAdjust(_ adjust: ReconcileAdjust) async throws -> ReconcileAdjustResult {
        try JSONDecoder().decode(ReconcileAdjustResult.self, from: await call("native/reconcile-adjust", args: adjust))
    }

    public func reconcileLock(_ lock: ReconcileLock) async throws -> ReconcileLockResult {
        try JSONDecoder().decode(ReconcileLockResult.self, from: await call("native/reconcile-lock", args: lock))
    }
}
