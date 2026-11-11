import Foundation

// Fork-only (sc-3584, ADR 11). Native code reads loot-core only through these
// handlers. Keep in step with packages/desktop-client/src/data/native-bridge-allowlist.json
// (a test compares them). Each native screen story adds the writes it needs.
public enum NativeBridgeAllowlist {
    public static let handlers: Set<String> = ["native/budget-month", "query"]
}

public enum NativeBridgeError: Error, Equatable {
    case notAllowlisted(String)
    case noPage
    case badResult
}

// Calls the page bridge. `transport` takes the handler name and its arguments
// as JSON, and returns the handler's result as JSON (the app runs it through
// WKWebView.callAsyncJavaScript; tests pass a fake).
public struct NativeBridgeClient {
    public typealias Transport = (_ name: String, _ argsJSON: String) async throws -> String

    private let transport: Transport

    public init(transport: @escaping Transport) {
        self.transport = transport
    }

    public func call(_ name: String, args: [String: String] = [:]) async throws -> Data {
        guard NativeBridgeAllowlist.handlers.contains(name) else {
            throw NativeBridgeError.notAllowlisted(name)
        }
        let argsJSON = String(decoding: try JSONEncoder().encode(args), as: UTF8.self)
        return Data(try await transport(name, argsJSON).utf8)
    }

    public func budgetMonth(_ month: String) async throws -> BudgetMonth {
        try JSONDecoder().decode(BudgetMonth.self, from: await call("native/budget-month", args: ["month": month]))
    }
}
