import AppKit
import Foundation
import NativeBridgeCore
import OSLog
import WebKit

// Fork-only (sc-4942, add-mac-app-shell). Hosts the one loot-core engine: the
// staged web build in a plain WKWebView, served by WWWSchemeHandler at
// homeeconomics://localhost with the default persistent website data store.
// It replaces what NativeBridgePlugin does in the iPhone app:
// - `actualNativeBridge` messages count only from the app's own main frame;
// - native reads and writes go through NativeBridgeClient over PageCall;
// - the page knows the shell by its user agent (`HomeEconomicsMac/<version>`),
//   so no user script is added.
// Nothing here weakens WebKit: no private API, no file-URL access, and no
// script while the main frame is off the app's own page (PageCall checks).
@MainActor
final class MacEngineHost: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    static let serverURL = URL(string: "\(WWWSchemeHandler.scheme)://\(WWWSchemeHandler.host)")!

    let webView: WKWebView
    // Every forwarded event, then one coalesced call per burst
    var onEvent: ((String) -> Void)?
    var onChange: (() -> Void)?
    var onRefusedSignIn: (() -> Void)?
    var onBudgetState: ((BudgetState) -> Void)?
    // The page that showed a link; replaceable in tests
    var sourceOrigin: (WKNavigationAction) -> PageOrigin? = MacEngineHost.sourceOrigin
    private lazy var coalescer = ChangeCoalescer { [weak self] in self?.onChange?() }
    private let policy: NavigationPolicy
    private let openInBrowser: (URL) -> Void
    private static let logger = Logger(subsystem: "app.homeeconomics.budget.mac", category: "navigation")

    // sc-5219: whether this device has stored the writes made through `client`
    let writeStorage = WriteStorageStatus()

    lazy var client = NativeBridgeClient(storage: writeStorage) { [weak self] name, argsJSON in
        guard let self else { throw NativeBridgeError.noPage }
        return try await PageCall(runner: self.webView, serverURL: Self.serverURL).bridgeCall(name: name, argsJSON: argsJSON)
    }

    init(
        www: URL, version: String, policy: NavigationPolicy = NavigationPolicy(allowedHosts: NavigationPolicy.bundledHosts()),
        openInBrowser: @escaping (URL) -> Void = { NSWorkspace.shared.open($0) }
    ) {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(WWWSchemeHandler(root: www), forURLScheme: WWWSchemeHandler.scheme)
        configuration.websiteDataStore = .default()
        configuration.applicationNameForUserAgent = "HomeEconomicsMac/\(version)"
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isInspectable = Self.isInspectable(debugBuild: Self.isDebugBuild)
        self.policy = policy
        self.openInBrowser = openInBrowser
        super.init()
        configuration.userContentController.add(self, name: "actualNativeBridge")
        webView.navigationDelegate = self
        webView.uiDelegate = self
    }

    #if DEBUG
    static let isDebugBuild = true
    #else
    static let isDebugBuild = false
    #endif

    // Story 5186: Safari's Web Inspector may attach to a Debug build only, to
    // diagnose a stalled page. It can read everything the page holds, the
    // sign-in token included, so a Release build is never inspectable.
    nonisolated static func isInspectable(debugBuild: Bool) -> Bool { debugBuild }

    // Replaceable in tests
    lazy var loadPage: (URLRequest) -> Void = { [weak self] in _ = self?.webView.load($0) }
    var now: () -> Date = Date.init
    var onPageGone: (() -> Void)?

    func load() {
        loadPage(URLRequest(url: WWWSchemeHandler.appURL))
    }

    private var reloads = ReloadGuard()

    // The user's Reload, after the app stopped reloading on its own
    func reloadAfterGivingUp() {
        reloads.reset()
        load()
    }

    // Story 5186: WebKit ended the page's process (memory pressure, a crash),
    // which leaves an empty window. Reload the app's own page, never the URL
    // the web view last showed. loot-core's database lives in IndexedDB, but
    // it is written there asynchronously: a change survives once it has been
    // flushed (measured: 1 s and 5 s after a write it survived; killed at once,
    // the last changes were gone). A bridge call in flight fails, usually at
    // once with `.pageOrigin` (else with its timeout), and is not retried.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if reloads.allowsReload(at: now()) {
            Self.logger.notice("page process ended; reloading the app's page")
            load()
        } else {
            Self.logger.notice("page process ended again; asking before reloading")
            onPageGone?()
        }
    }

    nonisolated static func acceptsMessage(isMainFrame: Bool, scheme: String, host: String, port: Int) -> Bool {
        PageOriginGuard.accepts(isMainFrame: isMainFrame, scheme: scheme, host: host, port: port, serverURL: serverURL)
    }

    // MARK: WKScriptMessageHandler

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        let origin = message.frameInfo.securityOrigin
        receive(message.body, isMainFrame: message.frameInfo.isMainFrame, scheme: origin.protocol, host: origin.host, port: origin.port)
    }

    func receive(_ body: Any, isMainFrame: Bool, scheme: String, host: String, port: Int) {
        // Only the app's own page: the provider's sign-in pages load in this web view too
        guard Self.acceptsMessage(isMainFrame: isMainFrame, scheme: scheme, host: host, port: port),
            let event = NativeBridgeEvent.name(of: body)
        else { return }
        if event == "budget-state" {
            // Its exact shape or nothing (task 1.4a)
            if let state = BudgetState.parse(body) { onBudgetState?(state) }
            return
        }
        if let seq = NativeBridgeEvent.storedSeq(of: body) {
            Task { @MainActor [writeStorage] in writeStorage.storedEvent(seq: seq) }
        }
        onEvent?(event)
        coalescer.notify()
    }

    // MARK: WKNavigationDelegate

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = action.request.url else { return .cancel }
        switch policy.decide(url, isMainFrame: action.targetFrame?.isMainFrame ?? true, userClicked: Self.userClicked(action), fromAppPage: isFromAppPage(action)) {
        case .allow:
            return .allow
        case .openInBrowser:
            openInBrowser(url)
            return .cancel
        case .refuseSignIn:
            // Never the URL: a redirect here can carry a sign-in token or code
            Self.logger.notice("refused a navigation to an unlisted host")
            onRefusedSignIn?()
            return .cancel
        case .cancel:
            Self.logger.notice("refused a navigation")
            return .cancel
        }
    }

    // A link the user activated. WebKit reports a redirect, a script
    // navigation and a form post as other types. macOS exposes no public
    // user-gesture flag beyond this, so a script's synthetic click on a link
    // can still count: it only opens the browser at a URL the page itself
    // shows, never a redirect's target.
    static func userClicked(_ action: WKNavigationAction) -> Bool {
        action.navigationType == .linkActivated
    }

    // WebKit can hand over no source frame, so read it as optional
    static func sourceOrigin(_ action: WKNavigationAction) -> PageOrigin? {
        guard let frame = action.sourceFrame as WKFrameInfo? else { return nil }
        let origin = frame.securityOrigin
        return PageOrigin(scheme: origin.protocol, host: origin.host, port: origin.port, isMainFrame: frame.isMainFrame)
    }

    // The link was on the app's own page, in its main frame
    private func isFromAppPage(_ action: WKNavigationAction) -> Bool {
        guard let origin = sourceOrigin(action) else { return false }
        return Self.acceptsMessage(isMainFrame: origin.isMainFrame, scheme: origin.scheme, host: origin.host, port: origin.port)
    }

    // MARK: WKUIDelegate

    // A link that asks for a new window opens in the browser, never in a second web view
    func webView(
        _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = action.request.url, url.scheme?.lowercased() == "https", Self.userClicked(action), isFromAppPage(action) {
            openInBrowser(url)
        }
        return nil
    }
}
