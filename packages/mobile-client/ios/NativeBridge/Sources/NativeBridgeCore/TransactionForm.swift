import Foundation

// Fork-only (sc-3602, openspec/changes/native-add-transaction D1 and D2). The
// native Add transaction sheet's reads, as loot-core returns them
// (packages/loot-core/src/server/native/transaction-form.ts). Every amount,
// rule result and field error is loot-core's, in integer minor units; native
// code shows them and never parses, adds or rounds money.
public struct TransactionForm: Codable, Equatable {
    public struct Account: Codable, Equatable, Identifiable {
        public let id: String
        public let name: String
        public let offbudget: Bool
        // The account's transfer payee, which the Transfer state puts in the draft (D8a)
        public let transferPayee: String?
    }

    public struct Category: Codable, Equatable, Identifiable {
        public let id: String
        public let name: String
        // Hidden in the budget: not for a new row; an edited row may keep it (PR 444)
        public let hidden: Bool
    }

    public struct CategoryGroup: Codable, Equatable, Identifiable {
        public let id: String
        public let name: String
        public let isIncome: Bool
        public let categories: [Category]
    }

    public struct Defaults: Codable, Equatable {
        public let account: String?
        // yyyy-MM-dd
        public let date: String
        public let cleared: Bool
    }

    public struct Schedule: Codable, Equatable {
        public let id: String
        public let name: String?
    }

    // A transfer partner's own fields, so Reload can show a change made only on the other side
    public struct Partner: Codable, Equatable {
        public let id: String
        public let account: String
        public let date: String
        public let amount: Int
        public let notes: String
        public let cleared: Bool
        public let reconciled: Bool
    }

    public struct Row: Codable, Equatable, Identifiable {
        public let id: String
        public let date: String
        public let payee: String?
        public let payeeName: String?
        public let category: String?
        public let categoryName: String?
        public let notes: String
        public let cleared: Bool
        public let reconciled: Bool
        public let amount: Int
        public let transferAccount: AccountRegister.TransferAccount?
        public let transferAccountClosed: Bool
        public let partner: Partner?
    }

    // The parent with its children; the digest binds an edit's save (D3)
    public struct Transaction: Codable, Equatable, Identifiable {
        public let id: String
        public let account: String
        public let date: String
        public let payee: String?
        public let payeeName: String?
        public let category: String?
        public let categoryName: String?
        public let notes: String
        public let cleared: Bool
        public let reconciled: Bool
        public let amount: Int
        public let transferAccount: AccountRegister.TransferAccount?
        public let transferAccountClosed: Bool
        public let partner: Partner?
        public let schedule: Schedule?
        public let attachments: [String]
        public let splits: [Row]
        public let digest: String
    }

    public let currencyCode: String
    public let currencyDecimalPlaces: Int
    public let currencySymbol: String
    public let currencySymbolPosition: BudgetMonth.SymbolPosition
    public let currencySpace: Bool
    public let numberFormat: BudgetMonth.NumberFormat
    public let hideFraction: Bool
    public let accounts: [Account]
    public let categoryGroups: [CategoryGroup]
    // An add's defaults, or nil for an edit
    public let defaults: Defaults?
    public let transaction: Transaction?
}

public struct PayeeList: Codable, Equatable {
    public struct Payee: Codable, Equatable, Identifiable {
        public let id: String
        public let name: String
        public let favorite: Bool
    }

    public let payees: [Payee]
}

// The fields the person set or cleared by hand after a rule touched them (D2a)
public enum TransactionUserField: String, Codable, CaseIterable {
    case account, date, payee, category, notes, cleared, amount, splits
}

// The per-field codes, fixtures/transaction-field-errors.json. A separate
// list from NativeRefusal.Code: these describe one field, never a refusal.
public enum TransactionFieldError: String, Codable, CaseIterable {
    case amountInvalid = "amount-invalid"
    case amountRequired = "amount-required"
    case accountRequired = "account-required"
    case accountClosed = "account-closed"
    case categoryNotAllowed = "category-not-allowed"
    case categoryUnknown = "category-unknown"
    case dateInvalid = "date-invalid"
    case splitMismatch = "split-mismatch"
    case splitLimit = "split-limit"
    case payeeTooLong = "payee-too-long"
    case notesTooLong = "notes-too-long"
    case transferSameAccount = "transfer-same-account"
    case categoryHidden = "category-hidden"
    // A leading minus or a result below zero; the sign comes from the control (PR 450)
    case amountNegative = "amount-negative"
}

// The draft the sheet sends and the preview returns. Only these keys reach
// loot-core, which checks them again (D2).
public struct TransactionDraft: Codable, Equatable {
    public struct Split: Codable, Equatable {
        public var id: String?
        public var payee: String?
        public var category: String?
        public var notes: String
        public var inflow: Bool
        public var amountText: String
    }

    // An add's lowercase UUID, kept for the sheet's lifetime (D3)
    public var newId: String?
    // An edit's transaction
    public var id: String?
    public var account: String
    public var date: String
    public var payee: String?
    public var payeeName: String?
    public var category: String?
    public var notes: String
    public var cleared: Bool
    public var inflow: Bool
    public var amountText: String
    public var splits: [Split]
    public var userFields: [TransactionUserField]
}

public struct TransactionPreview: Codable, Equatable {
    // A replaced field's previous value, as Restore puts it back (D2a)
    public enum PreviousValue: Codable, Equatable {
        case text(String?)
        case flag(Bool)
        case amount(amountText: String, inflow: Bool)
        case splits([TransactionDraft.Split])

        private enum AmountKeys: String, CodingKey { case amountText, inflow }

        public init(from decoder: Decoder) throws {
            if let amount = try? decoder.container(keyedBy: AmountKeys.self),
                let text = try? amount.decode(String.self, forKey: .amountText)
            {
                self = .amount(amountText: text, inflow: try amount.decode(Bool.self, forKey: .inflow))
                return
            }
            let value = try decoder.singleValueContainer()
            if value.decodeNil() {
                self = .text(nil)
            } else if let flag = try? value.decode(Bool.self) {
                self = .flag(flag)
            } else if let splits = try? value.decode([TransactionDraft.Split].self) {
                self = .splits(splits)
            } else {
                self = .text(try value.decode(String.self))
            }
        }

        public func encode(to encoder: Encoder) throws {
            switch self {
            case .amount(let text, let inflow):
                var container = encoder.container(keyedBy: AmountKeys.self)
                try container.encode(text, forKey: .amountText)
                try container.encode(inflow, forKey: .inflow)
            case .text(let text):
                var value = encoder.singleValueContainer()
                try value.encode(text)
            case .flag(let flag):
                var value = encoder.singleValueContainer()
                try value.encode(flag)
            case .splits(let splits):
                var value = encoder.singleValueContainer()
                try value.encode(splits)
            }
        }
    }

    public struct Replaced: Codable, Equatable {
        public let field: TransactionUserField
        public let value: PreviousValue
    }

    public let draft: TransactionDraft
    // Signed minor units, nil while the amount text is not a valid amount
    public let amount: Int?
    public let splitAmounts: [Int?]
    public let ruleFields: [TransactionUserField]
    public let replaced: [Replaced]
    // The parent minus the children's sum, for a split
    public let remaining: Int?
    // One field's error. Only amount-invalid carries a detail: the budget's
    // decimal separator, never what was typed (PR 450)
    public struct FieldError: Codable, Equatable {
        public struct Detail: Codable, Equatable {
            public let decimalSeparator: String
        }

        public let code: TransactionFieldError
        public let detail: Detail?
    }

    // By field: "amount", or "splits.<index>.<field>" for a child
    public let errors: [String: FieldError]
}

// The form's read and preview arguments, as the page forwards them (D4)
public struct TransactionFormRequest: Encodable, Equatable {
    public let id: String?
    public let accountId: String?

    public init(id: String? = nil, accountId: String? = nil) {
        (self.id, self.accountId) = (id, accountId)
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case accountId = "account_id"
    }
}

public struct TransactionPreviewRequest: Encodable, Equatable {
    public let draft: TransactionDraft
    public let changedField: TransactionUserField?

    public init(draft: TransactionDraft, changedField: TransactionUserField?) {
        (self.draft, self.changedField) = (draft, changedField)
    }
}
