import Capacitor

// Fork-only (sc-3584, sc-3514): registers the app's own plugins. There is one
// instance, owned by NativeTabBarController (the app's root), which moves it
// between tabs. Only the host app's bridge registers NativeBridgePlugin, so an app extension (widget, App Intent) has no
// way to reach it or start an engine of its own (native-bridge spec).
class AppBridgeViewController: CAPBridgeViewController {
    let nativeBridge = NativeBridgePlugin()
    let nativeChrome = NativeChromePlugin()
    private var benchmarkTrigger: NativeBridgeBenchmarkTrigger?

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(nativeBridge)
        bridge?.registerPluginInstance(nativeChrome)
        #if DEBUG
        NativeBridgeBenchmarkHarness.startIfRequested(plugin: nativeBridge)
        #endif
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        benchmarkTrigger = NativeBridgeBenchmarkTrigger(controller: self, client: nativeBridge.client)
    }
}
