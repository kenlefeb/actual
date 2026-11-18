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
    private static var deathDelay: Double { UserDefaults.standard.double(forKey: "UITestPageDeathDelay") }
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
            guard deaths > 0 else {
                show("ready", identifier: "uiTestPageRecoveryReady", in: webView)
                return
            }
            // Time for a test to open a budget first (sc-5220's screenshots)
            try? await Task.sleep(nanoseconds: UInt64(deathDelay * 1_000_000_000))
            let before = address(webView)
            var after = ""
            for _ in 0..<deaths {
                delegate.webViewWebContentProcessDidTerminate(webView)
                // Read at once: the page's own router can move on after it loads
                after = address(webView)
                await settle(webView)
            }
            show("before=\(before) after=\(after)", identifier: "uiTestPageRecovery", in: webView)
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

    // At the bottom of the screen, clear of the notice strip
    private static func show(_ text: String, identifier: String, in webView: WKWebView) {
        // With a delay the run is for looking at the screen, so nothing is added to it
        guard let window = webView.window, deathDelay == 0 else { return }
        let label = UILabel(frame: CGRect(x: 0, y: window.bounds.height - 80, width: window.bounds.width, height: 40))
        label.text = text
        label.numberOfLines = 2
        label.font = .systemFont(ofSize: 10)
        label.backgroundColor = .systemBackground
        label.accessibilityIdentifier = identifier
        window.addSubview(label)
    }
}
#endif
