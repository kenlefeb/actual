import Foundation

// Fork-only (sc-4341). The `native/schedules-paychecks` result, as loot-core
// returns it (packages/loot-core/src/server/native/app.ts). Every date and
// amount is loot-core's: native code shows them and never works one out
// (ADR 11). Amounts are integer minor units; dates are yyyy-MM-dd.
public struct SchedulesPaychecks: Codable, Equatable {
    public struct Summary: Codable, Equatable {
        public let hasPaychecks: Bool
        public let nextDate: String?
        public let netAmount: Int?
        // Schedules the list shows by default: not completed, not a paycheck's
        public let scheduleCount: Int
        public let anyWarning: Bool
    }

    public struct Deposit: Codable, Equatable, Identifiable {
        public let id: String
        public let account: String
        public let amount: Int
        public let date: String
        public let accountName: String
    }

    public struct PlannedPaycheck: Codable, Equatable {
        public let date: String
        public let deposits: [Deposit]
    }

    public struct ClearingWarning: Codable, Equatable {
        public struct MissingDeposit: Codable, Equatable, Identifiable {
            public let id: String
            public let account: String
            public let accountName: String
        }
        public let clearingAccount: String
        public let clearingAccountName: String
        public let balance: Int
        public let missingDeposits: [MissingDeposit]
    }

    public struct Paycheck: Codable, Equatable, Identifiable {
        public let id: String
        public let name: String
        public let netAmount: Int
        public let next: PlannedPaycheck?
        public let skipped: [String]
        public let later: [PlannedPaycheck]
        public let clearingWarning: ClearingWarning?
    }

    // getStatus' words (#shared/schedules); a word added later still decodes
    public enum Status: Codable, Equatable {
        case completed, paid, due, upcoming, missed, scheduled
        case other(String)

        static let known: [String: Status] = [
            "completed": .completed, "paid": .paid, "due": .due, "upcoming": .upcoming, "missed": .missed,
            "scheduled": .scheduled,
        ]

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

    public struct Schedule: Codable, Equatable, Identifiable {
        public let id: String
        public let name: String?
        public let payeeName: String?
        public let accountName: String?
        public let nextDate: String?
        public let amount: Int
        public let isApprox: Bool
        public let completed: Bool
        public let status: Status
    }

    public let currencyCode: String
    public let currencyDecimalPlaces: Int
    public let currencySymbol: String
    public let currencySymbolPosition: BudgetMonth.SymbolPosition
    public let currencySpace: Bool
    public let numberFormat: BudgetMonth.NumberFormat
    public let hideFraction: Bool
    // The paychecks feature flag; the web screens show while it is off
    public let enabled: Bool
    public let summary: Summary
    public let paychecks: [Paycheck]
    public let schedules: [Schedule]

    public var amountStyle: BudgetAmountStyle {
        BudgetAmountStyle(
            currencyCode: currencyCode, currencySymbol: currencySymbol, decimalPlaces: currencyDecimalPlaces,
            symbolPosition: currencySymbolPosition, symbolSpace: currencySpace, numberFormat: numberFormat,
            hideFraction: hideFraction)
    }
}

// `paycheck-skip-next` from native code: a paycheck id and the nonce that
// lets native/undo reverse exactly this skip. The page checks the id again
// against a fresh paychecks-get.
public struct PaycheckSkip: Encodable, Equatable {
    public let id: String
    public let undoToken: String

    public init(id: String, undoToken: String = UUID().uuidString) throws {
        guard !id.isEmpty else { throw NativeBridgeError.invalidWrite("id") }
        guard !undoToken.isEmpty else { throw NativeBridgeError.invalidWrite("undoToken") }
        (self.id, self.undoToken) = (id, undoToken)
    }
}

// `native/undo`: loot-core undoes the latest step only if it carries `token`
public struct NativeUndo: Encodable, Equatable {
    public let token: String

    public init(token: String) throws {
        guard !token.isEmpty else { throw NativeBridgeError.invalidWrite("token") }
        self.token = token
    }
}
