import Foundation

// Fork-only (sc-3584, ADR 11). Native code reads loot-core only through these
// handlers. This list is the security boundary: the page's copy
// (packages/desktop-client/src/data/native-bridge-allowlist.json, compared by
// a test) only stops accidents. Each native screen story adds the writes it needs.
public enum NativeBridgeAllowlist {
    // Sent only as their typed value (BudgetAmountWrite), never as loose arguments
    public static let writes: Set<String> = ["budget/budget-amount"]
    public static let handlers: Set<String> = Set(["native/budget-month", "query"]).union(writes)
}

public enum NativeBridgeError: Error, Equatable {
    case notAllowlisted(String)
    case timedOut(String)
    case noPage
    case badResult
    // A write built from a value loot-core would mishandle; never sent (sc-3769)
    case invalidWrite(String)
}

// The arguments of `budget/budget-amount`. loot-core's handler trusts them, so
// the value is checked here, before it can be built, and again by the page.
// The amount is an integer in minor units, as native/budget-month returns it.
public struct BudgetAmountWrite: Encodable, Equatable {
    public let category: String
    public let month: String
    public let amount: Int

    // loot-core stores amounts as JavaScript numbers
    private static let maxAmount = 9_007_199_254_740_991

    public init(category: String, month: String, amount: Int) throws {
        guard !category.isEmpty, category != "to-budget" else { throw NativeBridgeError.invalidWrite("category") }
        guard month.range(of: #"^[0-9]{4}-(0[1-9]|1[0-2])\z"#, options: .regularExpression) != nil else {
            throw NativeBridgeError.invalidWrite("month")
        }
        guard amount.magnitude <= Self.maxAmount else { throw NativeBridgeError.invalidWrite("amount") }
        (self.category, self.month, self.amount) = (category, month, amount)
    }
}

// Calls the page bridge. `transport` takes the handler name and its arguments
// as JSON, and returns the handler's result as JSON (the app runs it through
// WKWebView.callAsyncJavaScript; tests pass a fake).
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
        guard !NativeBridgeAllowlist.writes.contains(name) || args is BudgetAmountWrite else {
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

    public func budgetMonth(_ month: String) async throws -> BudgetMonth {
        try JSONDecoder().decode(BudgetMonth.self, from: await call("native/budget-month", args: ["month": month]))
    }

    // Not a task group: a group waits for every child, and callAsyncJavaScript
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
