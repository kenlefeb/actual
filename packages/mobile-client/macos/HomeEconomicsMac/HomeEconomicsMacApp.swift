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
    private lazy var lifecycle = EngineLifecycle(
        reread: { [weak self] in self?.rereads?.notify() },
        flush: { [weak self] done in
            let client = self?.host?.client
            Task { @MainActor in
                await client?.flushStorage()
                done()
            }
        })
    private var running = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        let www = Bundle.main.resourceURL!.appendingPathComponent("www")
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        let host = MacEngineHost(www: www, version: version)
        // Native views (story 4951) subscribe here; one re-read per burst
        rereads = ChangeCoalescer {}
        host.onChange = { [weak self] in self?.rereads?.notify() }
        // The page stays on its sign-in screen; nothing went to the browser
        host.onRefusedSignIn = { [weak self] in self?.showSignInNotSupported() }
        host.onPageGone = { [weak self] in self?.showPageGone() }
        host.presentDialog = { [weak self] request, answer in self?.showPageDialog(request, answer: answer) }
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
        host.webView.autoresizingMask = [.width, .height]
        let content = NSView(frame: window.contentRect(forFrameRect: window.frame))
        host.webView.frame = content.bounds
        content.addSubview(host.webView)
        window.contentView = content
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

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        lifecycle.shouldTerminate { sender.reply(toApplicationShouldTerminate: true) }
        return .terminateLater
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

    // sc-5399: a page's alert, confirm or prompt, as a sheet on the window. Returns
    // how to take it off screen, or nil while it can't show (the window is hidden
    // or has another sheet); PageDialogs then tries again and answers Cancel.
    private func showPageDialog(_ request: PageDialogRequest, answer: @escaping @MainActor (PageDialogAnswer) -> Void) -> (() -> Void)? {
        guard let window, window.isVisible, window.attachedSheet == nil else { return nil }
        let alert = NSAlert()
        // Another site's dialog is headed with its host, so it can't pass for the app's
        alert.messageText = request.title ?? request.message
        if request.title != nil { alert.informativeText = request.message }
        alert.addButton(withTitle: String(localized: "OK", comment: "Button in a dialog from the app's page"))
        var field: NSTextField?
        switch request.kind {
        case .alert: break
        case .confirm:
            alert.addButton(withTitle: String(localized: "Cancel", comment: "Button in a dialog from the app's page"))
        case .prompt(let defaultText):
            alert.addButton(withTitle: String(localized: "Cancel", comment: "Button in a dialog from the app's page"))
            let input = NSTextField(string: defaultText ?? "")
            input.frame = NSRect(x: 0, y: 0, width: 260, height: 24)
            alert.accessoryView = input
            alert.window.initialFirstResponder = input
            field = input
        }
        alert.beginSheetModal(for: window) { response in
            let ok = response == .alertFirstButtonReturn
            MainActor.assumeIsolated {
                switch request.kind {
                case .alert: answer(.dismissed)
                case .confirm: answer(.confirmed(ok))
                case .prompt: answer(.text(ok ? field?.stringValue ?? "" : nil))
                }
            }
        }
        return { [weak window, weak alert] in
            if let sheet = alert?.window, sheet.sheetParent != nil { window?.endSheet(sheet, returnCode: .abort) }
        }
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
