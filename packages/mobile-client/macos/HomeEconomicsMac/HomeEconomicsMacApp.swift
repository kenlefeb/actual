import AppKit
import NativeBridgeCore
import SwiftUI

// Fork-only (sc-4942, add-mac-app-shell). The SwiftUI Mac app. Its one main
// window holds the engine's web view as the bottom layer; native views (story
// 4951) go above it. The window is AppKit-owned so closing it only hides it
// and the engine keeps running (EngineLifecycle).
@main
struct HomeEconomicsMacApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        Settings { EmptyView() }
            .commands {
                #if DEBUG
                CommandMenu("Debug") {
                    Button("Time a Budget Month Read") { appDelegate.timeBudgetMonthRead() }
                }
                #endif
            }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var window: NSWindow?
    private var host: MacEngineHost?
    private var rereads: ChangeCoalescer?
    private lazy var lifecycle = EngineLifecycle { [weak self] in self?.rereads?.notify() }
    private var running = false
    private var notices: WindowNotices?
    private var inputMonitor: Any?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let www = Bundle.main.resourceURL!.appendingPathComponent("www")
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        let host = MacEngineHost(www: www, version: version)
        // Native views (story 4951) subscribe here; one re-read per burst
        rereads = ChangeCoalescer {}
        host.onChange = { [weak self] in self?.rereads?.notify() }
        // The page stays on its sign-in screen; nothing went to the browser
        host.onRefusedSignIn = { [weak self] in self?.showSignInNotSupported() }
        host.onPageGone = { [weak self] in
            self?.notices?.clear()
            self?.showPageGone()
        }
        let storage = StorageLossMonitor(defaults: UserDefaults.standard) { [weak self] in self?.showStorageLost() }
        host.onBudgetState = { storage.handle($0) }
        self.host = host

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1200, height: 800),
            styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Home Economics"
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.setFrameAutosaveName("MainWindow")
        let content = NoticeContainer(frame: window.contentRect(forFrameRect: window.frame), content: host.webView)
        window.contentView = content
        installNotices(in: content, host: host)
        window.center()
        window.makeKeyAndOrderFront(nil)
        self.window = window

        let center = NSWorkspace.shared.notificationCenter
        center.addObserver(self, selector: #selector(willSleep), name: NSWorkspace.willSleepNotification, object: nil)
        center.addObserver(self, selector: #selector(didWake), name: NSWorkspace.didWakeNotification, object: nil)
        host.load()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        EngineLifecycle.terminatesAfterLastWindowClosed
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag, let window { lifecycle.reopen(window) }
        return true
    }

    func applicationDidBecomeActive(_ notification: Notification) { lifecycle.didBecomeActive() }
    func applicationDidResignActive(_ notification: Notification) { lifecycle.didResignActive() }
    @objc private func willSleep() { lifecycle.willSleep() }
    @objc private func didWake() { lifecycle.didWake() }

    func windowShouldClose(_ sender: NSWindow) -> Bool { lifecycle.windowShouldClose(sender) }

    func windowDidBecomeKey(_ notification: Notification) { updateNoticeWindowState() }
    func windowDidResignKey(_ notification: Notification) { updateNoticeWindowState() }
    func windowDidChangeOcclusionState(_ notification: Notification) { updateNoticeWindowState() }

    private func updateNoticeWindowState() {
        guard let window else { return }
        notices?.windowChanged(isKeyAndVisible: window.isKeyWindow && window.occlusionState.contains(.visible))
    }

    // Story 5220: the notice strip under the title bar
    private func installNotices(in strip: NoticeContainer, host: MacEngineHost) {
        let notices = WindowNotices(
            schedule: { delay, work in DispatchQueue.main.asyncAfter(deadline: .now() + delay) { work() } },
            announce: { text in
                NSAccessibility.post(
                    element: NSApp as Any, notification: .announcementRequested,
                    userInfo: [.announcement: text, .priority: NSAccessibilityPriorityLevel.high.rawValue])
            })
        notices.onChange = { strip.show($0?.text) }
        strip.onDismiss = { [weak notices] in notices?.clear() }
        host.onAutomaticReload = { notices.show(.pageRestarted) }
        host.onPageLoaded = { notices.pageDidLoad() }
        // Tab from the page reaches Dismiss, and comes back
        host.webView.nextKeyView = strip.dismissButton
        strip.dismissButton.nextKeyView = host.webView
        inputMonitor = NSEvent.addLocalMonitorForEvents(
            matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown, .keyDown, .scrollWheel]
        ) { [weak notices] event in
            notices?.noteInput()
            return event
        }
        self.notices = notices
    }

    // Task 1.4a: the web view's data was cleared while a budget was open
    // Story 5186: the page's process kept ending, so the app stopped reloading it
    private func showPageGone() {
        guard let window, let host else { return }
        let alert = NSAlert()
        alert.messageText = String(localized: "The budget page stopped working")
        alert.informativeText = String(
            localized: "Reload to open it again. A change made in the last moment before it stopped may need to be made again.")
        alert.addButton(withTitle: String(localized: "Reload"))
        if let sheet = window.attachedSheet { window.endSheet(sheet) }
        alert.beginSheetModal(for: window) { _ in host.reloadAfterGivingUp() }
    }

    private func showStorageLost() {
        guard let window else { return }
        let alert = NSAlert()
        alert.messageText = String(localized: "This Mac's budget data was cleared")
        alert.informativeText = String(
            localized: "Changes that weren't synced may be lost. Sign in and download your budget again.")
        if let sheet = window.attachedSheet { window.endSheet(sheet) }
        alert.beginSheetModal(for: window)
    }

    // Until story 4984: a server or sign-in provider the app doesn't list
    private func showSignInNotSupported() {
        guard let window, window.attachedSheet == nil else { return }
        let alert = NSAlert()
        alert.messageText = String(localized: "This server's sign-in isn't supported in the Mac app yet")
        alert.informativeText = String(localized: "Sign in with your password instead.")
        alert.beginSheetModal(for: window)
    }

    #if DEBUG
    // Task 1.6 and spike criterion 4: times `native/budget-month` reads of
    // this month on the open budget. Read-only.
    func timeBudgetMonthRead() {
        guard let host, !running else { return }
        running = true
        let month = NativeBridgeBenchmark.currentMonth()
        Task { @MainActor in
            let alert = NSAlert()
            do {
                let result = try await NativeBridgeBenchmark.run(client: host.client, month: month, count: 20, warmUp: 2)
                alert.messageText = "Budget month read"
                alert.informativeText = result.summary
            } catch {
                alert.messageText = "Budget month read failed"
                alert.informativeText = String(describing: error)
            }
            running = false
            alert.runModal()
        }
    }
    #endif
}
