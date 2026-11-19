import Capacitor
import UIKit
import WebKit

// sc-5219 (design D7a, "The storage guard is turned on per shell"): whether the
// iPhone has opted in to the storage guard. Off until the guard-on PR, which
// sets it with the bridge's guard call; until then no storage notice runs.
enum StorageGuardRollout {
    static let isOn = false
}

#if DEBUG
// Test-only: `-UITestStorageNotice failure|full|restart|fullRestart|lost|closed`
// shows one storage notice after the first load, for the Designer's screenshots
enum UITestStorageNotice {
    static var isOn: Bool { UserDefaults.standard.string(forKey: "UITestStorageNotice") != nil }
    private static var shown = false

    @MainActor static func showOnce(_ notices: StorageNotices, storage: WriteStorageStatus) {
        guard !shown, let kind = UserDefaults.standard.string(forKey: "UITestStorageNotice") else { return }
        shown = true
        let flushedAt = (Date().timeIntervalSince1970 - 90) * 1000
        switch kind {
        case "failure": notices.failed(lastStoredFlushAt: flushedAt, quota: false)
        case "full": notices.failed(lastStoredFlushAt: flushedAt, quota: true)
        case "restart", "fullRestart":
            notices.failed(lastStoredFlushAt: flushedAt, quota: kind == "fullRestart")
            notices.restarted()
        case "closed": notices.closeFailed()
        default:
            storage.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "uitest-old", n: 1)))
            storage.pageLoaded(epoch: "uitest-new")
        }
    }
}
#endif

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
    private weak var reloadAlert: UIAlertController?
    private var activeObserver: NSObjectProtocol?
    private var inactiveObserver: NSObjectProtocol?
    private var loadingObservation: NSKeyValueObservation?
    // sc-5220: the strip at the top of the screen (PageNoticeWindow)
    let pageNotices = WindowNotices(
        schedule: { delay, work in
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                work()
            }
        },
        announce: { text in
            // Queued, so it does not cut across what VoiceOver is reading
            let queued = NSAttributedString(string: text, attributes: [.accessibilitySpeechQueueAnnouncement: true])
            UIAccessibility.post(notification: .announcement, argument: queued)
        })
    // sc-5247: `loadWebView` loads the app's own start page, never the URL the
    // page last showed, which can be a used one-time sign-in callback
    private lazy var pageRecovery = PageRecovery(
        reload: { [weak self] in self?.loadWebView() },
        giveUp: { [weak self] in self?.askToReload() ?? false },
        onEvent: { [weak self] event in
            switch event {
            case .automaticReload:
                self?.pageNotices.show(.pageRestarted)
                self?.storageNotices?.restarted()
            case .asking: self?.pageNotices.clear()
            }
        })

    // sc-5219: only once this shell has opted in to the storage guard
    private lazy var storageNotices: StorageNotices? = {
        var isOn = StorageGuardRollout.isOn
        #if DEBUG
        isOn = isOn || UITestStorageNotice.isOn
        #endif
        guard isOn else { return nil }
        return StorageNotices(slot: pageNotices, storage: nativeBridge.writeStorage) { [weak self] in self?.loadWebView() }
    }()

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(nativeBridge)
        nativeBridge.onStorageEvent = { [weak self] body in
            if let failure = NativeBridgeEvent.storageFailure(of: body) {
                self?.storageNotices?.failed(lastStoredFlushAt: failure.lastStoredFlushAt, quota: failure.quota)
            } else if NativeBridgeEvent.name(of: body) == "storage-close-failed" {
                self?.storageNotices?.closeFailed()
            }
        }
        // Follows "may not have been saved" from the first page load on
        _ = storageNotices
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
        // A page that died while the app wasn't active still needs its alert
        activeObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.pageRecovery.appBecameActive()
                self?.pageNotices.windowChanged(isActive: true)
            }
        }
        inactiveObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.willResignActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.pageNotices.windowChanged(isActive: false) }
        }
        pageNotices.windowChanged(isActive: UIApplication.shared.applicationState == .active)
        // Finished or failed: either way the app is showing what it can
        loadingObservation = webView?.observe(\.isLoading) { [weak self] webView, _ in
            MainActor.assumeIsolated {
                if !webView.isLoading {
                    self?.pageNotices.pageDidLoad()
                    self?.storageNotices?.pageLoaded()
                    #if DEBUG
                    if let self, let notices = self.storageNotices {
                        UITestStorageNotice.showOnce(notices, storage: self.nativeBridge.writeStorage)
                    }
                    #endif
                }
            }
        }
        #if DEBUG
        if let webView, let pageProcessDelegate, let serverURL = bridge?.config.serverURL {
            UITestPageRecovery.startIfRequested(webView: webView, delegate: pageProcessDelegate, serverURL: serverURL)
            UITestKillWrites.startIfRequested(webView: webView, serverURL: serverURL)
        }
        #endif
    }

    // The page's process kept ending, so the app stopped reloading it. Returns
    // whether the alert is on screen. This controller's own view has no window
    // while a native tab shows, so the alert goes on the active scene's window.
    private func askToReload() -> Bool {
        if reloadAlert?.presentingViewController != nil { return true }
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        guard var presenter = scene?.keyWindow?.rootViewController else { return false }
        while let next = presenter.presentedViewController, !next.isBeingDismissed { presenter = next }
        guard presenter.presentedViewController == nil, !presenter.isBeingPresented else { return false }
        let alert = UIAlertController(
            title: NSLocalizedString("The app stopped working", comment: "Alert after repeated page failures"),
            message: NSLocalizedString(
                "Reload to open it again. A change you made in the last moment may not have been saved. Check it, and make it again if it’s missing.",
                comment: "Alert after repeated page failures"),
            preferredStyle: .alert)
        alert.addAction(
            UIAlertAction(title: NSLocalizedString("Reload", comment: "Alert button: load the page again"), style: .default) {
                [weak self] _ in self?.pageRecovery.userReload()
            })
        presenter.present(alert, animated: true)
        guard presenter.presentedViewController === alert else { return false }
        reloadAlert = alert
        return true
    }
}
