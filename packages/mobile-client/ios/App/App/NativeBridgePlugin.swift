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
    // The Schedules & Paychecks overlay (sc-4341): each event with a
    // sync-event's changed table names; it coalesces its own re-reads
    var onPaychecksEvent: ((String, [String]) -> Void)?
    // sc-5219: storage-failed and storage-close-failed, for the storage notices
    var onStorageEvent: ((Any) -> Void)?
    // sc-5219: a page load without the storage guard this shell opted in to
    var onPageUnguarded: ((String) -> Void)?
    var onChange: (() -> Void)?
    // sc-3611: the budget's sync outcome for the Accounts subtitle, kept while
    // the screen comes and goes; main queue
    private(set) var syncStatus = NativeSyncStatus.unknown
    var onSyncStatus: ((NativeSyncStatus) -> Void)?
    private lazy var coalescer = ChangeCoalescer { [weak self] in self?.onChange?() }

    // sc-5219: whether this device has stored the writes made through `client`
    let writeStorage = WriteStorageStatus()

    lazy var client = NativeBridgeClient(storage: writeStorage, storageGuardOn: StorageGuardRollout.isOn) { [weak self] name, argsJSON in
        guard let self else { throw NativeBridgeError.noPage }
        return try await self.evaluate(name: name, argsJSON: argsJSON)
    }

    // Runs before the page loads (CAPBridgeViewController.loadView), so the
    // page sees the message handler when it installs its bridge
    override public func load() {
        // This shell's opt-in to the storage guard reaches the page with the
        // native screens' script (NativeChromePlugin), the one user script allowed
        bridge?.webView?.configuration.userContentController.add(self, name: "actualNativeBridge")
    }

    public func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        // Only the app's own page: sign-in pages load in this web view too
        let origin = message.frameInfo.securityOrigin
        guard PageOriginGuard.accepts(isMainFrame: message.frameInfo.isMainFrame, scheme: origin.protocol, host: origin.host, port: origin.port, serverURL: bridge?.config.serverURL),
              let event = NativeBridgeEvent.name(of: message.body) else { return }
        // In order, on the main thread, so a page's "ready" comes before anything it answers
        MainActor.assumeIsolated {
            if let epoch = NativeBridgeEvent.readyEpoch(of: message.body) {
                // sc-5219, Security's mismatch check: logged in every build, flagged on the status
                let reported = NativeBridgeEvent.readyGuard(of: message.body)
                let mismatch = StorageGuardMismatch.message(shellOptedIn: StorageGuardRollout.isOn, pageReported: reported)
                NSLog("actual storage guard: shell opted in = %@, page reports %@%@", "\(StorageGuardRollout.isOn)",
                      "\(reported.map(String.init) ?? "nothing")", mismatch.map { "; \($0)" } ?? "")
                // Security's ruling: writes of a page without the guard are never confirmed, and a notice offers Reload
                let unconfirmed = StorageGuardMismatch.writesUnconfirmed(shellOptedIn: StorageGuardRollout.isOn, pageReported: reported)
                writeStorage.pageLoaded(epoch: epoch, guardMismatch: mismatch != nil, writesUnconfirmed: unconfirmed)
                if unconfirmed { onPageUnguarded?(epoch) }
            }
            if let stored = NativeBridgeEvent.stored(of: message.body) { writeStorage.storedEvent(seq: stored.seq, epoch: stored.epoch) }
            if event == "storage-failed" { writeStorage.storageFailed() }
            if event == "storage-failed" || event == "storage-close-failed" { onStorageEvent?(message.body) }
        }
        onEvent?(event)
        onPaychecksEvent?(event, NativeBridgeEvent.tables(of: message.body))
        let status = syncStatus.next(after: message.body, now: Date())
        if status != syncStatus {
            syncStatus = status
            onSyncStatus?(status)
        }
        coalescer.notify()
    }

    // Only on the app's own page (PageCall, sc-3859)
    @MainActor
    private func evaluate(name: String, argsJSON: String) async throws -> String {
        guard let webView = bridge?.webView else { throw NativeBridgeError.noPage }
        return try await PageCall(runner: webView, serverURL: bridge?.config.serverURL).bridgeCall(name: name, argsJSON: argsJSON)
    }
}
