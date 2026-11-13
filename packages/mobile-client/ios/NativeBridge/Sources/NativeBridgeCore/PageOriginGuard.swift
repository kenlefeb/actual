import Foundation

#if canImport(WebKit)
import WebKit
#endif

// Fork-only (sc-3697). Sign-in pages and any other frame load in the same web
// view, so a plugin accepts a script message only from the app's own page:
// the main frame, on the app server's scheme, host and port. Pure, so it runs
// under `swift test`; the plugins pass in what WKScriptMessage reports (WebKit
// gives port 0 for a scheme's default port, as URL.port does when absent).
public enum PageOriginGuard {
    public static func accepts(isMainFrame: Bool, scheme: String, host: String, port: Int, serverURL: URL?) -> Bool {
        guard isMainFrame, let url = serverURL, let serverScheme = url.scheme?.lowercased() else { return false }
        let messageScheme = scheme.lowercased()
        return messageScheme == serverScheme
            && host.lowercased() == url.host?.lowercased()
            && effectivePort(port, scheme: messageScheme) == effectivePort(url.port ?? 0, scheme: serverScheme)
    }

    // Port 0 means the scheme's default, so compare effective ports.
    static func effectivePort(_ port: Int, scheme: String) -> Int {
        port != 0 ? port : defaultPort(scheme) ?? 0
    }

    static func defaultPort(_ scheme: String) -> Int? {
        scheme == "https" ? 443 : scheme == "http" ? 80 : nil
    }
}

// What PageCall runs a script in: the web view, or a fake in tests.
@MainActor
public protocol PageScriptRunner: AnyObject {
    var mainFrameURL: URL? { get }
    // Runs `script` as an async function body in the main frame, page world
    func callPageMainFrame(_ script: String, arguments: [String: Any]) async throws -> Any?
}

// Fork-only (sc-3859). The one path for every Swift call into the page: bridge
// reads and writes, native chrome calls and the benchmark. A sign-in page or the
// sync server's own web app can be in the main frame, so the call runs only on
// the app's own page, checked twice: here against the main frame URL, then in
// the page against `location.origin`, which covers a navigation that commits
// in between. A foreign page can replace any global, so the in-page check uses
// only `!==` and returns a fixed string before it touches anything else.
// fork/scripts/check-native-swift.mjs fails on any other call into the page.
@MainActor
public struct PageCall {
    // What the in-page check returns on a foreign page
    public static let sentinel = "actual-native-bridge:origin-refused"
    // Not `location` or `window`, which would shadow the globals the check reads
    public static let originArgument = "expectedOrigin"
    private static let reservedArguments: Set<String> = [originArgument, "location", "window"]

    // The page bridge call (packages/desktop-client/src/native/nativeBridge.ts)
    public static let bridgeCallBody = """
        const bridge = window.__actualNativeBridge;
        if (!bridge) throw new Error('native bridge: page not ready');
        return await bridge.call(name, JSON.parse(args));
        """

    private let runner: PageScriptRunner
    private let serverURL: URL?

    public init(runner: PageScriptRunner, serverURL: URL?) {
        self.runner = runner
        self.serverURL = serverURL
    }

    // The server URL as `location.origin` writes it: lowercased, default port left out
    public static func expectedOrigin(serverURL: URL?) -> String? {
        guard let url = serverURL, let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased(), !host.isEmpty
        else { return nil }
        let port = url.port.flatMap { $0 == PageOriginGuard.defaultPort(scheme) ? nil : $0 }
        // Foundation drops an IPv6 host's brackets; location.origin keeps them
        let authority = host.contains(":") ? "[\(host)]" : host
        return "\(scheme)://\(authority)" + (port.map { ":\($0)" } ?? "")
    }

    // The in-page check, then `body` with its result or error in a shape only
    // a confirmed call returns
    public static func script(_ body: String) -> String {
        """
        if (location.origin !== \(originArgument)) return '\(sentinel)';
        try {
          return { confirmed: true, value: await (async () => {
        \(body)
          })() };
        } catch (e) {
          return { confirmed: true, error: String(e && e.message !== undefined ? e.message : e) };
        }
        """
    }

    // Runs `body` on the app's own page and returns its result. Throws
    // `.pageOrigin` for a foreign or missing page, and for any outcome the page
    // did not confirm (the sentinel, an exception, any other value), whose text
    // may hold the foreign URL and is never kept. A bridge error from the app's
    // own page comes back as `.page(message)`.
    public func run(_ body: String, arguments: [String: Any] = [:]) async throws -> Any? {
        guard let origin = Self.expectedOrigin(serverURL: serverURL), let url = runner.mainFrameURL,
            PageOriginGuard.accepts(isMainFrame: true, scheme: url.scheme ?? "", host: url.host ?? "", port: url.port ?? 0, serverURL: serverURL)
        else { throw NativeBridgeError.pageOrigin }
        var checked = arguments.filter { !Self.reservedArguments.contains($0.key) }
        checked[Self.originArgument] = origin
        let result: Any?
        do {
            result = try await runner.callPageMainFrame(Self.script(body), arguments: checked)
        } catch {
            throw NativeBridgeError.pageOrigin
        }
        guard let shape = result as? [String: Any], shape["confirmed"] as? Bool == true else {
            throw NativeBridgeError.pageOrigin
        }
        if let message = shape["error"] as? String { throw NativeBridgeError.page(message) }
        return shape["value"]
    }

    // A page bridge call: the handler's result as JSON
    public func bridgeCall(name: String, argsJSON: String) async throws -> String {
        guard let json = try await run(Self.bridgeCallBody, arguments: ["name": name, "args": argsJSON]) as? String else {
            throw NativeBridgeError.badResult
        }
        return json
    }
}

#if canImport(WebKit)
// The only place that calls into the page: main frame (no WKFrameInfo), page world
extension WKWebView: PageScriptRunner {
    public var mainFrameURL: URL? { url }

    public func callPageMainFrame(_ script: String, arguments: [String: Any]) async throws -> Any? {
        try await callAsyncJavaScript(script, arguments: arguments, in: nil, contentWorld: .page)
    }
}
#endif
