import Capacitor

// Fork-only (sc-3584): registers the app's own plugins (Main.storyboard uses
// this class instead of CAPBridgeViewController).
class AppBridgeViewController: CAPBridgeViewController {
    let nativeBridge = NativeBridgePlugin()

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(nativeBridge)
        #if DEBUG
        NativeBridgeBenchmark.startIfRequested(plugin: nativeBridge)
        #endif
    }
}
