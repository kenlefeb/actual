import Foundation
import OSLog
import UniformTypeIdentifiers
import WebKit

struct WWWResponse {
    let status: Int
    let headers: [String: String]
    let body: Data
}

// Fork-only (sc-4942, add-mac-app-shell). Serves the bundled web build at
// homeeconomics://localhost, and nothing else:
// - only that host, on that scheme, with no port;
// - the path is percent-decoded once and standardized, and the file must sit
//   inside the build folder (its path plus "/"), after symlinks are resolved;
// - NUL, backslash, a leftover "%" (double encoding) and empty segments are refused;
// - an extensionless path that is not a file gets index.html, because client
//   routes such as /openid-cb are not files; a missing file with an extension is 404;
// - the query and fragment are ignored and never logged: the OpenID return
//   carries the sign-in token in its query. A refused request logs its path only.
// Every answer carries COOP and COEP, as sync-server/app.ts sends them.
final class WWWSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "homeeconomics"
    static let host = "localhost"
    static let appURL = URL(string: "\(scheme)://\(host)/")!

    private let root: URL
    private let rootPrefix: String
    private let log: (String) -> Void

    private static let logger = Logger(subsystem: "app.homeeconomics.budget.mac", category: "www")
    static func defaultLog(_ message: String) {
        logger.notice("\(message, privacy: .public)")
    }

    init(root: URL, log: @escaping (String) -> Void = WWWSchemeHandler.defaultLog) {
        self.root = root.standardizedFileURL.resolvingSymlinksInPath()
        rootPrefix = self.root.path + "/"
        self.log = log
    }

    private static let isolation = [
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
    ]

    // Types WebKit needs exactly, ahead of the system's table
    private static let mimeTypes = [
        "js": "text/javascript", "mjs": "text/javascript", "wasm": "application/wasm",
        "html": "text/html", "css": "text/css", "json": "application/json",
        "webmanifest": "application/manifest+json", "svg": "image/svg+xml",
    ]

    static func mimeType(_ ext: String) -> String {
        let ext = ext.lowercased()
        return mimeTypes[ext] ?? UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
    }

    private enum Resolution { case file(URL), notFound, refused(String) }

    private func resolve(_ url: URL) -> Resolution {
        // The path as sent, without the query or fragment
        let raw = url.path(percentEncoded: true)
        guard url.scheme?.lowercased() == Self.scheme, url.host?.lowercased() == Self.host, url.port == nil else {
            return .refused(raw)
        }
        guard let decoded = raw.removingPercentEncoding,
            !decoded.contains("\0"), !decoded.contains("\\"), !decoded.contains("%"), !decoded.contains("//")
        else { return .refused(raw) }

        let relative = decoded.drop(while: { $0 == "/" })
        if relative.isEmpty { return .file(root.appendingPathComponent("index.html")) }
        let candidate = root.appendingPathComponent(String(relative)).standardizedFileURL.resolvingSymlinksInPath()
        guard candidate.path.hasPrefix(rootPrefix) else { return .refused(raw) }

        var isDirectory: ObjCBool = false
        if FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDirectory), !isDirectory.boolValue {
            return .file(candidate)
        }
        return candidate.pathExtension.isEmpty ? .file(root.appendingPathComponent("index.html")) : .notFound
    }

    func response(for url: URL) -> WWWResponse {
        switch resolve(url) {
        case .file(let file):
            guard let data = try? Data(contentsOf: file) else { return WWWResponse(status: 404, headers: Self.isolation, body: Data()) }
            var headers = Self.isolation
            headers["Content-Type"] = Self.mimeType(file.pathExtension)
            headers["Content-Length"] = String(data.count)
            return WWWResponse(status: 200, headers: headers, body: data)
        case .notFound:
            return WWWResponse(status: 404, headers: Self.isolation, body: Data())
        case .refused(let path):
            // The path only: never the query or fragment
            log("refused \(path)")
            return WWWResponse(status: 403, headers: Self.isolation, body: Data())
        }
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(URLError(.badURL))
            return
        }
        let answer = response(for: url)
        guard let http = HTTPURLResponse(url: url, statusCode: answer.status, httpVersion: "HTTP/1.1", headerFields: answer.headers)
        else {
            task.didFailWithError(URLError(.cannotParseResponse))
            return
        }
        task.didReceive(http)
        task.didReceive(answer.body)
        task.didFinish()
    }

    // Answers are synchronous, so there is nothing to cancel
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
