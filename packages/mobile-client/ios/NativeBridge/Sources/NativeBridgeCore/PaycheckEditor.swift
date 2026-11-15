import Foundation

// Fork-only (sc-4343). The native paycheck editor's contract with loot-core:
// the stored definition it edits, the draft preview, the save and delete
// writes and year-to-date. Every amount, date and error comes from loot-core
// (native/paycheck-preview, packages/loot-core/src/server/native/app.ts);
// Swift edits fields and shows answers, nothing more (ADR 11).

// A paycheck definition as loot-core stores it (PaycheckDefinition in
// packages/loot-core/src/types/models/paycheck.ts). Optional fields stay
// absent when loot-core left them out, so a save sends back what it read.
public struct PaycheckDefinition: Codable, Equatable {
    public struct Pattern: Codable, Equatable, Hashable {
        public var value: Int
        // "day" or a weekday code ("MO" ... "SU")
        public var type: String

        public init(value: Int, type: String) { (self.value, self.type) = (value, type) }
    }

    public struct RecurConfig: Codable, Equatable {
        public var frequency: String
        public var interval: Int?
        public var patterns: [Pattern]?
        public var skipWeekend: Bool?
        public var start: String
        public var endMode: String?
        public var endOccurrences: Int?
        public var endDate: String?
        public var weekendSolveMode: String?
        public var businessCalendarId: String?
    }

    public struct Deduction: Codable, Equatable, Identifiable {
        public var id: String
        public var name: String
        public var amount: Int
        public var category: String?
        // "" while a transfer has no account yet; absent or null for a category
        public var transferAccount: String?

        public var isTransfer: Bool { transferAccount != nil }

        public init(id: String, name: String, amount: Int, category: String?, transferAccount: String? = nil) {
            (self.id, self.name, self.amount, self.category, self.transferAccount) = (id, name, amount, category, transferAccount)
        }

        private enum Keys: String, CodingKey { case id, name, amount, category, transferAccount }

        // Cleared fields go as null: the save lays the draft over the stored
        // definition, where a missing key would keep the old value (PR 366)
        public func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: Keys.self)
            try c.encode(id, forKey: .id)
            try c.encode(name, forKey: .name)
            try c.encode(amount, forKey: .amount)
            try c.encode(category, forKey: .category)
            try c.encode(transferAccount, forKey: .transferAccount)
        }
    }

    public struct Deposit: Codable, Equatable, Identifiable {
        public var id: String
        public var account: String
        // "fixed", "percent" or "remainder"
        public var kind: String
        // Cents for fixed, a percent of net pay for percent (may have decimals)
        public var value: Double
        public var postAutomatically: Bool?
        // The generated deposit schedule; never edited here
        public var schedule: String?
    }

    public var payee: String?
    public var clearingAccount: String
    public var date: RecurConfig
    public var weekendSolveMode: String
    public var grossAmount: Int
    public var incomeCategory: String?
    public var deductions: [Deduction]
    public var deposits: [Deposit]
    // The generated pay schedule; never edited here
    public var paySchedule: String?

    // Explicit nulls where loot-core reads null, not "absent"
    private enum Keys: String, CodingKey {
        case payee, clearingAccount, date, weekendSolveMode, grossAmount, incomeCategory, deductions, deposits, paySchedule
    }

    public init(
        payee: String?, clearingAccount: String, date: RecurConfig, weekendSolveMode: String, grossAmount: Int,
        incomeCategory: String?, deductions: [Deduction], deposits: [Deposit], paySchedule: String? = nil
    ) {
        (self.payee, self.clearingAccount, self.date, self.weekendSolveMode) = (payee, clearingAccount, date, weekendSolveMode)
        (self.grossAmount, self.incomeCategory, self.deductions, self.deposits) = (grossAmount, incomeCategory, deductions, deposits)
        self.paySchedule = paySchedule
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        payee = try c.decodeIfPresent(String.self, forKey: .payee)
        clearingAccount = try c.decode(String.self, forKey: .clearingAccount)
        date = try c.decode(RecurConfig.self, forKey: .date)
        weekendSolveMode = try c.decode(String.self, forKey: .weekendSolveMode)
        grossAmount = try c.decode(Int.self, forKey: .grossAmount)
        incomeCategory = try c.decodeIfPresent(String.self, forKey: .incomeCategory)
        deductions = try c.decode([Deduction].self, forKey: .deductions)
        deposits = try c.decode([Deposit].self, forKey: .deposits)
        paySchedule = try c.decodeIfPresent(String.self, forKey: .paySchedule)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        try c.encode(payee, forKey: .payee)
        try c.encode(clearingAccount, forKey: .clearingAccount)
        try c.encode(date, forKey: .date)
        try c.encode(weekendSolveMode, forKey: .weekendSolveMode)
        try c.encode(grossAmount, forKey: .grossAmount)
        try c.encode(incomeCategory, forKey: .incomeCategory)
        try c.encode(deductions, forKey: .deductions)
        try c.encode(deposits, forKey: .deposits)
        try c.encodeIfPresent(paySchedule, forKey: .paySchedule)
    }

    // A new paycheck, as the web form starts one (usePaycheckForm newDefinition)
    public static func new(today: String, depositId: String = UUID().uuidString) -> PaycheckDefinition {
        PaycheckDefinition(
            payee: nil, clearingAccount: "",
            date: RecurConfig(
                frequency: "monthly", interval: 1, patterns: [Pattern(value: 15, type: "day"), Pattern(value: -1, type: "day")],
                start: today, endMode: "never"),
            weekendSolveMode: "before", grossAmount: 0, incomeCategory: nil, deductions: [],
            deposits: [Deposit(id: depositId, account: "", kind: "remainder", value: 0)])
    }
}

// The draft the editor sends to native/paycheck-preview, and the base of a save
public struct PaycheckDraft: Encodable, Equatable {
    // The saved paycheck it edits; nil for a new one. The preview shows its
    // stored next date while the pay dates are unedited.
    public var id: String?
    public var name: String
    public var definition: PaycheckDefinition
    public var isNewAccount: Bool
    // Typed name of a new clearing account; empty uses "{employer} Paycheck"
    public var newClearingAccountName: String
    // Days early edited for deposit accounts
    public var daysEarly: [String: Int]

    public init(
        id: String? = nil, name: String, definition: PaycheckDefinition, isNewAccount: Bool, newClearingAccountName: String = "",
        daysEarly: [String: Int] = [:]
    ) {
        self.id = id
        (self.name, self.definition, self.isNewAccount) = (name, definition, isNewAccount)
        (self.newClearingAccountName, self.daysEarly) = (newClearingAccountName, daysEarly)
    }
}

// native/paycheck-preview's answer
public struct PaycheckPreview: Codable, Equatable {
    public struct Deposit: Codable, Equatable, Identifiable {
        public let id: String
        public let amount: Int
        public let date: String?
        public let savedDaysEarly: Int?
        // nil: weekends only
        public let calendarName: String?
    }

    public struct Error: Codable, Equatable, Hashable {
        public let code: String
        // name, clearingAccount, deductions or deposits
        public let field: String
    }

    public let netAmount: Int
    public let payDate: String?
    public let employerName: String?
    public let deposits: [Deposit]
    public let errors: [Error]
}

// The web form's messages for loot-core's draft error codes. A test checks
// this table against packages/desktop-client/src/data/paycheck-error-messages.json,
// which another test checks against the web form.
public enum PaycheckErrorText {
    public static let messages: [String: String] = [
        "name-missing": NSLocalizedString("Enter a name for the paycheck.", comment: "Paycheck editor error"),
        "clearing-name-missing": NSLocalizedString("Enter a name for the new clearing account.", comment: "Paycheck editor error"),
        "clearing-account-missing": NSLocalizedString("Choose the clearing account.", comment: "Paycheck editor error"),
        "clearing-account-not-open-on-budget": NSLocalizedString(
            "The clearing account must be an open on-budget account.", comment: "Paycheck editor error"),
        "duplicate-deposit-account": NSLocalizedString("Each deposit must go to a different account.", comment: "Paycheck editor error"),
        "transfer-account-missing": NSLocalizedString("Choose an account for each transfer deduction.", comment: "Paycheck editor error"),
        "deposit-account-missing": NSLocalizedString("Choose an account for each deposit.", comment: "Paycheck editor error"),
        "deposit-to-clearing-account": NSLocalizedString("A deposit cannot go to the clearing account.", comment: "Paycheck editor error"),
        "days-early-invalid": NSLocalizedString(
            "Business days early must be a whole number from 0 to 10.", comment: "Paycheck editor error"),
        "deductions-exceed-gross": NSLocalizedString("Deductions exceed gross pay.", comment: "Paycheck editor error"),
        "deposits-exceed-net": NSLocalizedString("Deposits exceed net pay.", comment: "Paycheck editor error"),
        "percents-exceed-100": NSLocalizedString("Percent deposits total more than 100%.", comment: "Paycheck editor error"),
        "multiple-remainders": NSLocalizedString("Only one deposit can be the remainder.", comment: "Paycheck editor error"),
        "deposits-do-not-add-up": NSLocalizedString(
            "Deposits must add up to net pay or include a remainder.", comment: "Paycheck editor error"),
        "no-deposits": NSLocalizedString("Add at least one direct deposit.", comment: "Paycheck editor error"),
    ]

    // A code this app doesn't know yet still shows something
    public static func message(_ code: String) -> String { messages[code] ?? code }
}

// `native/paycheck-save`: the draft, the paycheck it edits (nil creates one)
// and the nonce native/undo needs. Checked here and again by the page.
public struct PaycheckSave: Encodable, Equatable {
    public let id: String?
    public let name: String
    public let definition: PaycheckDefinition
    public let newClearingAccountName: String?
    public let daysEarly: [String: Int]
    public let undoToken: String

    // Days early as loot-core allows them (MAX_DEPOSIT_DAYS_EARLY)
    public static let daysEarlyRange = 0...10

    public init(id: String?, draft: PaycheckDraft, newClearingAccountName: String?, undoToken: String = UUID().uuidString) throws {
        guard id.map({ !$0.isEmpty }) ?? true else { throw NativeBridgeError.invalidWrite("id") }
        guard !undoToken.isEmpty else { throw NativeBridgeError.invalidWrite("undoToken") }
        guard draft.daysEarly.values.allSatisfy(Self.daysEarlyRange.contains) else { throw NativeBridgeError.invalidWrite("daysEarly") }
        self.id = id
        self.name = draft.name
        self.definition = draft.definition
        self.newClearingAccountName = newClearingAccountName
        self.daysEarly = draft.daysEarly
        self.undoToken = undoToken
    }
}

// `paycheck-delete` from native code; the page checks the id again
public struct PaycheckDelete: Encodable, Equatable {
    public let id: String
    public let undoToken: String

    public init(id: String, undoToken: String = UUID().uuidString) throws {
        guard !id.isEmpty else { throw NativeBridgeError.invalidWrite("id") }
        guard !undoToken.isEmpty else { throw NativeBridgeError.invalidWrite("undoToken") }
        (self.id, self.undoToken) = (id, undoToken)
    }
}

// paycheck-year-to-date, this year first
public struct PaycheckYearToDate: Codable, Equatable {
    public struct Deduction: Codable, Equatable {
        public let name: String
        public let amount: Int
    }
    public let year: Int
    public let gross: Int
    public let deductions: [Deduction]
    public let net: Int
    // loot-core says whether any pay posted; Swift never infers it from zeros
    public let hasHistory: Bool
}

// The editor's pickers, read through `query` with the AQL these send. The
// loot-core test runs packages/loot-core/src/server/native/fixtures/paycheck-editor-queries.json,
// and a Swift test checks these encode to exactly that.
public enum PaycheckEditorQuery {
    struct Query: Encodable {
        let table: String
        let filterExpressions: [[String: AnyEncodable]]
        let selectExpressions: [String]
        let orderExpressions: [String]
        let tableOptions: [String: String] = [:]
        let groupExpressions: [String] = []
        let calculation = false
        let rawMode = false
        let withDead = false
        let validateRefs = true
        let limit: Int? = nil
        let offset: Int? = nil

        private enum Keys: String, CodingKey {
            case table, tableOptions, filterExpressions, selectExpressions, groupExpressions, orderExpressions, calculation,
                rawMode, withDead, validateRefs, limit, offset
        }

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: Keys.self)
            try c.encode(table, forKey: .table)
            try c.encode(tableOptions, forKey: .tableOptions)
            try c.encode(filterExpressions, forKey: .filterExpressions)
            try c.encode(selectExpressions, forKey: .selectExpressions)
            try c.encode(groupExpressions, forKey: .groupExpressions)
            try c.encode(orderExpressions, forKey: .orderExpressions)
            try c.encode(calculation, forKey: .calculation)
            try c.encode(rawMode, forKey: .rawMode)
            try c.encode(withDead, forKey: .withDead)
            try c.encode(validateRefs, forKey: .validateRefs)
            try c.encode(limit, forKey: .limit)
            try c.encode(offset, forKey: .offset)
        }
    }

    static func paycheck(_ id: String) -> Query {
        Query(table: "paychecks", filterExpressions: [["id": AnyEncodable(id)]], selectExpressions: ["id", "name", "definition"], orderExpressions: [])
    }
    static let accounts = Query(
        table: "accounts", filterExpressions: [], selectExpressions: ["id", "name", "offbudget", "closed"], orderExpressions: ["sort_order"])
    static let payees = Query(
        table: "payees", filterExpressions: [["transfer_acct": AnyEncodable(nil as String?)]], selectExpressions: ["id", "name"],
        orderExpressions: ["name"])
    static let categories = Query(
        table: "categories", filterExpressions: [], selectExpressions: ["id", "name", "is_income", "hidden"], orderExpressions: ["sort_order"])
}

struct AnyEncodable: Encodable {
    private let encodeValue: (Encoder) throws -> Void
    init<T: Encodable>(_ value: T) { encodeValue = { try value.encode(to: $0) } }
    func encode(to encoder: Encoder) throws { try encodeValue(encoder) }
}

// What the pickers offer
public struct PaycheckEditorOptions: Equatable {
    public struct Account: Codable, Equatable, Identifiable {
        public let id: String
        public let name: String
        public let offbudget: Bool
        public let closed: Bool
    }
    public struct Payee: Codable, Equatable, Identifiable {
        public let id: String
        public let name: String
    }
    public struct Category: Codable, Equatable, Identifiable {
        public let id: String
        public let name: String
        public let is_income: Bool
        public let hidden: Bool
    }
    public var accounts: [Account] = []
    public var payees: [Payee] = []
    public var categories: [Category] = []

    public init(accounts: [Account] = [], payees: [Payee] = [], categories: [Category] = []) {
        (self.accounts, self.payees, self.categories) = (accounts, payees, categories)
    }

    public func accountName(_ id: String?) -> String? { accounts.first { $0.id == id }?.name }
    public func payeeName(_ id: String?) -> String? { payees.first { $0.id == id }?.name }
    public func categoryName(_ id: String?) -> String? { categories.first { $0.id == id }?.name }
    // Clearing and deposit pickers offer open accounts, as the web's account autocomplete
    public var openAccounts: [Account] { accounts.filter { !$0.closed } }
}

struct QueryRows<Row: Decodable>: Decodable {
    let data: [Row]
}

struct StoredPaycheck: Decodable {
    let id: String
    let name: String
    let definition: PaycheckDefinition
}

extension NativeBridgeClient {
    public func paycheckPreview(_ draft: PaycheckDraft) async throws -> PaycheckPreview {
        try JSONDecoder().decode(PaycheckPreview.self, from: await call("native/paycheck-preview", args: draft))
    }

    // The new or saved paycheck's id
    public func savePaycheck(_ save: PaycheckSave) async throws -> String {
        try JSONDecoder().decode(String.self, from: await call("native/paycheck-save", args: save))
    }

    public func deletePaycheck(_ delete: PaycheckDelete) async throws {
        _ = try await call("paycheck-delete", args: delete)
    }

    public func paycheckYearToDate(_ id: String) async throws -> [PaycheckYearToDate] {
        try JSONDecoder().decode([PaycheckYearToDate].self, from: await call("paycheck-year-to-date", args: ["id": id]))
    }

    // The stored paycheck to edit; nil once it is gone
    public func storedPaycheck(_ id: String) async throws -> (name: String, definition: PaycheckDefinition)? {
        let rows = try JSONDecoder().decode(
            QueryRows<StoredPaycheck>.self, from: await call("query", args: PaycheckEditorQuery.paycheck(id))
        ).data
        return rows.first.map { ($0.name, $0.definition) }
    }

    public func paycheckEditorOptions() async throws -> PaycheckEditorOptions {
        let decoder = JSONDecoder()
        return PaycheckEditorOptions(
            accounts: try decoder.decode(
                QueryRows<PaycheckEditorOptions.Account>.self, from: await call("query", args: PaycheckEditorQuery.accounts)
            ).data,
            payees: try decoder.decode(
                QueryRows<PaycheckEditorOptions.Payee>.self, from: await call("query", args: PaycheckEditorQuery.payees)
            ).data,
            categories: try decoder.decode(
                QueryRows<PaycheckEditorOptions.Category>.self, from: await call("query", args: PaycheckEditorQuery.categories)
            ).data)
    }
}

// Words for what the editor shows read-only, as the web schedule editor puts
// them (desktop-client util/schedule.ts), and money in with its "+"
// (DESIGN.native.md). Formatting only: every value is loot-core's.
public enum PaycheckDateText {
    private static let weekdays = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"]

    // A monthly weekday pattern: "Also paid: last Friday", "Also paid: 2nd Tuesday"
    public static func pattern(_ pattern: PaycheckDefinition.Pattern, locale: Locale = .current) -> String? {
        guard let index = weekdays.firstIndex(of: pattern.type) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = locale
        let day = calendar.standaloneWeekdaySymbols[index]
        let which: String
        if pattern.value == -1 {
            which = String(format: NSLocalizedString("last %@", comment: "Paycheck editor: e.g. last Friday"), day)
        } else {
            let ordinal = NumberFormatter()
            ordinal.locale = locale
            ordinal.numberStyle = .ordinal
            which = "\(ordinal.string(from: NSNumber(value: pattern.value)) ?? String(pattern.value)) \(day)"
        }
        return String(format: NSLocalizedString("Also paid: %@", comment: "Paycheck editor: a weekday pay date"), which)
    }

    // "Ends on Dec 31, 2027" or "Ends after 26 paychecks"; nil when it never ends
    public static func end(_ config: PaycheckDefinition.RecurConfig, locale: Locale = .current) -> String? {
        switch config.endMode {
        case "on_date":
            guard let day = config.endDate else { return nil }
            let parser = DateFormatter()
            parser.locale = Locale(identifier: "en_US_POSIX")
            parser.dateFormat = "yyyy-MM-dd"
            guard let date = parser.date(from: day) else { return nil }
            let formatter = DateFormatter()
            formatter.locale = locale
            formatter.dateStyle = .medium
            return String(format: NSLocalizedString("Ends on %@", comment: "Paycheck editor: end date"), formatter.string(from: date))
        case "after_n_occurrences":
            guard let count = config.endOccurrences else { return nil }
            return count == 1
                ? NSLocalizedString("Ends after 1 paycheck", comment: "Paycheck editor: end after one")
                : String(format: NSLocalizedString("Ends after %d paychecks", comment: "Paycheck editor: end after N"), count)
        default:
            return nil
        }
    }

    public static func incoming(_ amount: Int, style: BudgetAmountStyle) -> String {
        (amount > 0 ? "+" : "") + BudgetAmountFormat.string(amount, style: style)
    }
}
