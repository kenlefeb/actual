import Capacitor
import UIKit
import WebKit

// Fork-only (sc-3584, sc-3514): registers the app's own plugins. There is one
// instance, owned by NativeTabBarController (the app's root), which moves it
// between tabs. Only the host app's bridge registers NativeBridgePlugin, so an app extension (widget, App Intent) has no
// way to reach it or start an engine of its own (native-bridge spec).
class AppBridgeViewController: CAPBridgeViewController {
    let nativeBridge = NativeBridgePlugin()
    let nativeChrome = NativeChromePlugin()
    private var benchmarkTrigger: NativeBridgeBenchmarkTrigger?
    // The web view holds its navigation delegate weakly
    private var pageProcessDelegate: PageProcessDelegate?
    // sc-5247: `loadWebView` loads the app's own start page, never the URL the
    // page last showed, which can be a used one-time sign-in callback
    private lazy var pageRecovery = PageRecovery(
        reload: { [weak self] in self?.loadWebView() },
        giveUp: { [weak self] in self?.askToReload() })

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(nativeBridge)
        bridge?.registerPluginInstance(nativeChrome)
        if let webView, let handler = webView.navigationDelegate as? NSObject & WKNavigationDelegate {
            let delegate = PageProcessDelegate(forwardingTo: handler) { [weak self] in self?.pageRecovery.processEnded() }
            webView.navigationDelegate = delegate
            pageProcessDelegate = delegate
        }
        #if DEBUG
        NativeBridgeBenchmarkHarness.startIfRequested(plugin: nativeBridge)
        #endif
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        benchmarkTrigger = NativeBridgeBenchmarkTrigger(controller: self, client: nativeBridge.client)
        #if DEBUG
        if let webView, let pageProcessDelegate, let serverURL = bridge?.config.serverURL {
            UITestPageRecovery.startIfRequested(webView: webView, delegate: pageProcessDelegate, serverURL: serverURL)
        }
        #endif
    }

    // The page's process kept ending, so the app stopped reloading it
    private func askToReload() {
        var presenter = view.window?.rootViewController
        while let next = presenter?.presentedViewController { presenter = next }
        let alert = UIAlertController(
            title: NSLocalizedString("The budget page stopped working", comment: "Alert after repeated page failures"),
            message: NSLocalizedString(
                "Reload to open it again. A change made in the last moment before it stopped may need to be made again.",
                comment: "Alert after repeated page failures"),
            preferredStyle: .alert)
        alert.addAction(
            UIAlertAction(title: NSLocalizedString("Reload", comment: "Alert button: load the page again"), style: .default) {
                [weak self] _ in self?.pageRecovery.userReload()
            })
        presenter?.present(alert, animated: true)
    }
}
