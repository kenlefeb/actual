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
    // A per-screen switch changed in Settings (sc-3751)
    var onNativeScreenChanged: ((NativeTab) -> Void)?
    private let haptics = UIImpactFeedbackGenerator(style: .light)

    // Runs before the page loads, so the page sees the handler at startup
    override public func load() {
        guard let controller = bridge?.webView?.configuration.userContentController else { return }
        controller.add(self, name: "actualNativeChrome")
        installScreensScript(on: controller)
    }

    // Tells the page which native screens are on (for the Settings switch,
    // sc-3751) at the start of every load. WebKit reruns the script text it
    // was given, so a toggle replaces the script; otherwise a reload would
    // bring back the value from launch.
    private var screensScript: WKUserScript?

    private func installScreensScript(on controller: WKUserContentController) {
        if let old = screensScript {
            // No API removes one script; keep the others (Capacitor's)
            let others = controller.userScripts.filter { $0 !== old }
            controller.removeAllUserScripts()
            others.forEach(controller.addUserScript)
        }
        let script = WKUserScript(source: NativeScreensScript.source(), injectionTime: .atDocumentStart, forMainFrameOnly: true)
        screensScript = script
        controller.addUserScript(script)
    }

    public func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        // Only the app's own page: sign-in pages load in this web view too
        guard isFromAppPage(message),
              let body = message.body as? [String: Any], let type = body["type"] as? String
        else { return }
        switch type {
        case "route":
            if let path = body["path"] as? String { onRoute?(path, body["tabBar"] as? Bool ?? true) }
        case "closed":
            onClosed?()
        case "nativeScreen":
            // Only a tab that has a native screen can be switched
            if let name = body["screen"] as? String, let on = body["on"] as? Bool,
               let tab = NativeTab(rawValue: name), NativeScreenSwitch.nativeTabs.contains(tab) {
                UserDefaults.standard.set(on, forKey: NativeScreenSwitch.key(for: tab))
                if let controller = bridge?.webView?.configuration.userContentController { installScreensScript(on: controller) }
                onNativeScreenChanged?(tab)
            }
        case "haptic":
            // Follows the system's haptics setting
            haptics.impactOccurred()
        default:
            break
        }
    }

    private func isFromAppPage(_ message: WKScriptMessage) -> Bool {
        let origin = message.frameInfo.securityOrigin
        return PageOriginGuard.accepts(isMainFrame: message.frameInfo.isMainFrame, scheme: origin.protocol, host: origin.host, port: origin.port, serverURL: bridge?.config.serverURL)
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
}
