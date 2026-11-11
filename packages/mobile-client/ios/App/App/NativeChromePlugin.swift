import Capacitor
import UIKit
import WebKit

// Fork-only (sc-3514, ADR 11). Connects the native tab bar to the page side in
// packages/desktop-client/src/native/nativeChrome.ts. The page reports its
// route, asks for haptic taps and says when the budget closes, through the
// `actualNativeChrome` message handler; the tab bar asks the page to show a
// path through `window.__actualNativeChrome.navigate`, which the page checks
// against its section allowlist. A local plugin, no third-party code.
@objc(NativeChromePlugin)
public class NativeChromePlugin: CAPPlugin, CAPBridgedPlugin, WKScriptMessageHandler {
    public let identifier = "NativeChromePlugin"
    public let jsName = "NativeChrome"
    public let pluginMethods: [CAPPluginMethod] = []

    // Main queue
    // The path, and whether the tab bar shows (not on a pushed form or sheet)
    var onRoute: ((String, Bool) -> Void)?
    var onClosed: (() -> Void)?
    private let haptics = UIImpactFeedbackGenerator(style: .light)

    // Runs before the page loads, so the page sees the handler at startup
    override public func load() {
        bridge?.webView?.configuration.userContentController.add(self, name: "actualNativeChrome")
    }

    public func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        // Only the app's own page: sign-in pages load in this web view too
        guard message.frameInfo.isMainFrame, isAppOrigin(message.frameInfo.securityOrigin),
              let body = message.body as? [String: Any], let type = body["type"] as? String
        else { return }
        switch type {
        case "route":
            if let path = body["path"] as? String { onRoute?(path, body["tabBar"] as? Bool ?? true) }
        case "closed":
            onClosed?()
        case "haptic":
            // Follows the system's haptics setting
            haptics.impactOccurred()
        default:
            break
        }
    }

    func navigate(to path: String) {
        callPage("window.__actualNativeChrome?.navigate(path)", ["path": path])
    }

    // Ask the page to report its route again, after the app was in the background
    func reportRoute() {
        callPage("window.__actualNativeChrome?.report()", [:])
    }

    // native-bridge: nothing calls into the page while the app is in the
    // background, where its engine is suspended
    private func callPage(_ script: String, _ arguments: [String: Any]) {
        guard UIApplication.shared.applicationState != .background, let webView = bridge?.webView else { return }
        webView.callAsyncJavaScript(script, arguments: arguments, in: nil, in: .page) { result in
            if case .failure(let error) = result { CAPLog.print("NativeChrome: \(error.localizedDescription)") }
        }
    }

    private func isAppOrigin(_ origin: WKSecurityOrigin) -> Bool {
        guard let url = bridge?.config.serverURL else { return false }
        return origin.protocol == url.scheme && origin.host == url.host && (url.port ?? 0) == origin.port
    }
}
