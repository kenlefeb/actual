import Capacitor
import WebKit

// Fork-only (sc-3584, ADR 11). Native code reads loot-core, which keeps running
// in this WebView, through the page bridge in
// packages/desktop-client/src/native/nativeBridge.ts. Reads go out through
// `client` (allowlisted on both sides); `cells-changed` and `sync-event` come
// back through the `actualNativeBridge` message handler. Swift never opens the
// budget database (fork/scripts/check-native-swift.mjs enforces it).
@objc(NativeBridgePlugin)
public class NativeBridgePlugin: CAPPlugin, CAPBridgedPlugin, WKScriptMessageHandler {
    public let identifier = "NativeBridgePlugin"
    public let jsName = "NativeBridge"
    public let pluginMethods: [CAPPluginMethod] = []

    // Every forwarded event, then one coalesced re-read per burst; main queue
    var onEvent: ((String) -> Void)?
    var onChange: (() -> Void)?
    private lazy var coalescer = ChangeCoalescer { [weak self] in self?.onChange?() }

    lazy var client = NativeBridgeClient { [weak self] name, argsJSON in
        guard let self else { throw NativeBridgeError.noPage }
        return try await self.evaluate(name: name, argsJSON: argsJSON)
    }

    // Runs before the page loads (CAPBridgeViewController.loadView), so the
    // page sees the message handler when it installs its bridge
    override public func load() {
        bridge?.webView?.configuration.userContentController.add(self, name: "actualNativeBridge")
    }

    public func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        // Only the app's own page: sign-in pages load in this web view too
        let origin = message.frameInfo.securityOrigin
        guard PageOriginGuard.accepts(isMainFrame: message.frameInfo.isMainFrame, scheme: origin.protocol, host: origin.host, port: origin.port, serverURL: bridge?.config.serverURL),
              let body = message.body as? [String: Any], let event = body["event"] as? String else { return }
        onEvent?(event)
        coalescer.notify()
    }

    // Only on the app's own page (PageCall, sc-3859)
    @MainActor
    private func evaluate(name: String, argsJSON: String) async throws -> String {
        guard let webView = bridge?.webView else { throw NativeBridgeError.noPage }
        return try await PageCall(runner: webView, serverURL: bridge?.config.serverURL).bridgeCall(name: name, argsJSON: argsJSON)
    }
}
