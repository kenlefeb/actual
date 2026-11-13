import Foundation

// Fork-only (sc-3584, ADR 11). Native code reads loot-core only through these
// handlers. This list is the security boundary: the page's copy
// (packages/desktop-client/src/data/native-bridge-allowlist.json, compared by
// a test) only stops accidents. Each native screen story adds the writes it needs.
public enum NativeBridgeAllowlist {
    // Sent only as their typed value (BudgetAmountWrite, Transfer), never as loose arguments
    public static let writes: Set<String> = ["budget/budget-amount", "budget/transfer-category", "budget/transfer-available"]
    public static let handlers: Set<String> = Set(["native/budget-month", "query"]).union(writes)
}

public enum NativeBridgeError: Error, Equatable {
    case notAllowlisted(String)
    case timedOut(String)
    case noPage
    case badResult
    // A write built from a value loot-core would mishandle; never sent (sc-3769)
    case invalidWrite(String)
    // The main frame is not the app's own page (sc-3859). One fixed value, so
    // it carries nothing of a foreign page's URL or text.
    case pageOrigin
    // The app's own page bridge refused or failed the call; its message
    case page(String)
}

// The arguments of `budget/budget-amount`. loot-core's handler trusts them, so
// the value is checked here, before it can be built, and again by the page.
// The amount is an integer in minor units, as native/budget-month returns it.
public struct BudgetAmountWrite: Encodable, Equatable {
    public let category: String
    public let month: String
    public let amount: Int

    // loot-core stores amounts as JavaScript numbers
    static let maxAmount = 9_007_199_254_740_991

    public init(category: String, month: String, amount: Int) throws {
        guard !category.isEmpty, category != "to-budget" else { throw NativeBridgeError.invalidWrite("category") }
        guard Self.isMonth(month) else { throw NativeBridgeError.invalidWrite("month") }
        guard amount.magnitude <= Self.maxAmount else { throw NativeBridgeError.invalidWrite("amount") }
        (self.category, self.month, self.amount) = (category, month, amount)
    }

    static func isMonth(_ month: String) -> Bool {
        month.range(of: #"^[0-9]{4}-(0[1-9]|1[0-2])\z"#, options: .regularExpression) != nil
    }
}

// One end of a move: to-budget, or a category by id
public enum MoveEnd: Hashable {
    case toBudget
    case category(String)
}

// A move of money on an envelope month (sc-3787), checked against the month's
// snapshot before it can be built, and again by the page: a positive amount no
// larger than the source holds, two different ends, and only expense
// categories. Out of to-budget it is `budget/transfer-available`; otherwise
// `budget/transfer-category`, which would write a budget row for a category
// called to-budget if it were the source.
public struct Transfer: Encodable, Equatable {
    public let month: String
    public let from: MoveEnd
    public let to: MoveEnd
    public let amount: Int
    // Only labels loot-core's movement note: the budget's own, from the snapshot
    public let currencyCode: String

    public var handler: String { from == .toBudget ? "budget/transfer-available" : "budget/transfer-category" }

    public init(from: MoveEnd, to: MoveEnd, amount: Int, in snapshot: BudgetMonth) throws {
        guard snapshot.budgetType == .envelope, BudgetAmountWrite.isMonth(snapshot.month) else {
            throw NativeBridgeError.invalidWrite("month")
        }
        guard amount > 0, amount <= BudgetAmountWrite.maxAmount else { throw NativeBridgeError.invalidWrite("amount") }
        guard from != to, Self.isEnd(from, in: snapshot), Self.isEnd(to, in: snapshot) else {
            throw NativeBridgeError.invalidWrite("category")
        }
        guard amount <= Self.limit(of: from, in: snapshot) ?? 0 else { throw NativeBridgeError.invalidWrite("amount") }
        (self.month, self.from, self.to, self.amount, self.currencyCode) = (snapshot.month, from, to, amount, snapshot.currencyCode)
    }

    // What the end holds to move: the month's to-budget, or the category's balance
    public static func limit(of end: MoveEnd, in snapshot: BudgetMonth) -> Int? {
        switch end {
        case .toBudget: return snapshot.totals.toBudget
        case .category(let id): return expenseCategories(snapshot).first { $0.id == id }?.balance
        }
    }

    // Expense categories of any group, hidden ones included, as the page checks
    static func expenseCategories(_ snapshot: BudgetMonth) -> [BudgetMonth.Category] {
        snapshot.groups.filter { !$0.isIncome }.flatMap(\.categories)
    }

    private static func isEnd(_ end: MoveEnd, in snapshot: BudgetMonth) -> Bool {
        guard case .category(let id) = end else { return true }
        return id != "to-budget" && expenseCategories(snapshot).contains { $0.id == id }
    }

    private enum Keys: String, CodingKey { case month, amount, category, from, to, currencyCode }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: Keys.self)
        try container.encode(month, forKey: .month)
        try container.encode(amount, forKey: .amount)
        func id(_ end: MoveEnd) -> String {
            if case .category(let id) = end { return id }
            return "to-budget"
        }
        if from == .toBudget {
            try container.encode(id(to), forKey: .category)
        } else {
            try container.encode(id(from), forKey: .from)
            try container.encode(id(to), forKey: .to)
            try container.encode(currencyCode, forKey: .currencyCode)
        }
    }
}

// Calls the page bridge. `transport` takes the handler name and its arguments
// as JSON, and returns the handler's result as JSON (the app runs it through
// PageCall, which checks the page origin first; tests pass a fake).
public struct NativeBridgeClient {
    public typealias Transport = (_ name: String, _ argsJSON: String) async throws -> String

    // A call into a suspended WebContent process hangs until the app is in
    // the foreground again (sc-3584 findings), so every call has a deadline.
    public static let defaultTimeout: TimeInterval = 5

    private let transport: Transport
    private let timeout: TimeInterval

    public init(timeout: TimeInterval = NativeBridgeClient.defaultTimeout, transport: @escaping Transport) {
        self.timeout = timeout
        self.transport = transport
    }

    public func call(_ name: String) async throws -> Data {
        try await call(name, args: [String: String]())
    }

    // Arguments are any JSON value, so a number crosses as a number
    public func call<Args: Encodable>(_ name: String, args: Args) async throws -> Data {
        guard NativeBridgeAllowlist.handlers.contains(name) else {
            throw NativeBridgeError.notAllowlisted(name)
        }
        // Each write name takes only its own typed value
        let isTyped = (args is BudgetAmountWrite && name == "budget/budget-amount") || (args as? Transfer)?.handler == name
        guard !NativeBridgeAllowlist.writes.contains(name) || isTyped else {
            throw NativeBridgeError.invalidWrite(name)
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        let argsJSON = String(decoding: try encoder.encode(args), as: UTF8.self)
        return Data(try await withTimeout(name) { try await transport(name, argsJSON) }.utf8)
    }

    public func setBudgetAmount(_ write: BudgetAmountWrite) async throws {
        _ = try await call("budget/budget-amount", args: write)
    }

    public func transfer(_ transfer: Transfer) async throws {
        _ = try await call(transfer.handler, args: transfer)
    }

    public func budgetMonth(_ month: String) async throws -> BudgetMonth {
        try JSONDecoder().decode(BudgetMonth.self, from: await call("native/budget-month", args: ["month": month]))
    }

    // Not a task group: a group waits for every child, and a WebKit script call
    // into a suspended page ignores cancellation, so the deadline would never fire.
    private func withTimeout(_ name: String, _ work: @escaping () async throws -> String) async throws -> String {
        let once = ResumeOnce<String>()
        return try await withCheckedThrowingContinuation { continuation in
            once.continuation = continuation
            let task = Task {
                do { once.resume(.success(try await work())) } catch { once.resume(.failure(error)) }
            }
            let nanoseconds = UInt64(timeout * 1_000_000_000)
            Task {
                try? await Task.sleep(nanoseconds: nanoseconds)
                if once.resume(.failure(NativeBridgeError.timedOut(name))) { task.cancel() }
            }
        }
    }
}

// Resumes a continuation at most once, from whichever side finishes first
private final class ResumeOnce<T> {
    var continuation: CheckedContinuation<T, Error>?
    private let lock = NSLock()

    @discardableResult
    func resume(_ result: Result<T, Error>) -> Bool {
        lock.lock()
        let pending = continuation
        continuation = nil
        lock.unlock()
        pending?.resume(with: result)
        return pending != nil
    }
}
