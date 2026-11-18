#if DEBUG
import UIKit
import WebKit

// Test-only (sc-5247). With `-UITestPageDeaths N`, the app reports N ends of
// the page's process to its real recovery path, and writes on screen where the
// web view was before and right after, for PageRecoveryUITests to read. With
// `-UITestPageStartPath`, it first moves the page there: a stand-in for a
// one-time sign-in callback. Every address the web view shows is also appended
// to tmp/page-addresses.log, for a check that ends the real process from
// outside. Debug builds only.
@MainActor
enum UITestPageRecovery {
    private static var deaths: Int { UserDefaults.standard.integer(forKey: "UITestPageDeaths") }
    private static var startPath: String? { UserDefaults.standard.string(forKey: "UITestPageStartPath") }
    private static var observation: NSKeyValueObservation?

    static func startIfRequested(webView: WKWebView, delegate: PageProcessDelegate, serverURL: URL) {
        guard deaths > 0 || startPath != nil else { return }
        let log = FileManager.default.temporaryDirectory.appendingPathComponent("page-addresses.log")
        try? Data().write(to: log)
        observation = webView.observe(\.url, options: [.initial]) { webView, _ in
            MainActor.assumeIsolated { append(address(webView), to: log) }
        }
        Task {
            await settle(webView)
            if let startPath, let url = URL(string: serverURL.absoluteString + startPath) {
                webView.load(URLRequest(url: url))
                await settle(webView)
            }
            guard deaths > 0 else { return }
            let before = address(webView)
            var after = ""
            for _ in 0..<deaths {
                delegate.webViewWebContentProcessDidTerminate(webView)
                // Read at once: the page's own router can move on after it loads
                after = address(webView)
                await settle(webView)
            }
            show("before=\(before) after=\(after)", in: webView)
        }
    }

    private static func append(_ line: String, to log: URL) {
        guard let handle = try? FileHandle(forWritingTo: log) else { return }
        defer { try? handle.close() }
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: Data((line + "\n").utf8))
    }

    private static func address(_ webView: WKWebView) -> String {
        guard let url = webView.url else { return "none" }
        return url.path + (url.query.map { "?" + $0 } ?? "")
    }

    private static func settle(_ webView: WKWebView) async {
        for _ in 0..<200 {
            try? await Task.sleep(nanoseconds: 100_000_000)
            if !webView.isLoading && webView.url != nil { return }
        }
    }

    private static func show(_ text: String, in webView: WKWebView) {
        guard let window = webView.window else { return }
        let label = UILabel(frame: CGRect(x: 0, y: 60, width: window.bounds.width, height: 40))
        label.text = text
        label.numberOfLines = 2
        label.font = .systemFont(ofSize: 10)
        label.backgroundColor = .systemBackground
        label.accessibilityIdentifier = "uiTestPageRecovery"
        window.addSubview(label)
    }
}
#endif
