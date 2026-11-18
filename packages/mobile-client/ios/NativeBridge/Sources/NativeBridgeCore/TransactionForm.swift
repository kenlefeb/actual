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

// The preview (D2, PR 453): one rules run on the person's input. Swift shows
// `result` beside the input and sends the input, never the result.
public struct TransactionPreview: Codable, Equatable {
    public struct ResultSplit: Codable, Equatable {
        public let payee: String?
        // A payee name a rule set that no payee has yet; the save creates it
        public let payeeName: String?
        public let category: String?
        public let notes: String
        public let inflow: Bool
        // Signed minor units, nil while the amount text is not a valid amount
        public let amount: Int?
        // The engine's formatting, which "Keep this value" copies into the input
        public let amountText: String?
    }

    public struct Result: Codable, Equatable {
        public let account: String
        public let date: String
        public let payee: String?
        public let payeeName: String?
        public let category: String?
        public let notes: String
        public let cleared: Bool
        public let inflow: Bool
        public let amount: Int?
        public let amountText: String?
        public let splits: [ResultSplit]
    }

    // A rule's value for a hand-set field, as the engine shows it
    public struct Suggestion: Codable, Equatable {
        public struct Value: Codable, Equatable {
            public let id: String?
            public let name: String?
            public let text: String?
            public let flag: Bool?
            public let amount: Int?
            public let amountText: String?
        }

        public let field: TransactionUserField
        public let row: Int
        public let value: Value
    }

    // One field's error. Only amount-invalid carries a detail: the budget's
    // decimal separator, never what was typed (PR 450)
    public struct FieldError: Codable, Equatable {
        public struct Detail: Codable, Equatable {
            public let decimalSeparator: String
        }

        public let code: TransactionFieldError
        public let detail: Detail?
    }

    public let result: Result
    // Opaque: the save sends it back as previewDigest
    public let resultDigest: String
    public let ruleFields: [TransactionUserField]
    public let suggestions: [Suggestion]
    // The parent minus the children's sum, for a split
    public let remaining: Int?
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

    public init(draft: TransactionDraft) {
        self.draft = draft
    }
}
