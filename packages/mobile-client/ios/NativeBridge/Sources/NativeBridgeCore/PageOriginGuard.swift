import Foundation

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
    private static func effectivePort(_ port: Int, scheme: String) -> Int {
        port != 0 ? port : (scheme == "https" ? 443 : scheme == "http" ? 80 : 0)
    }
}
