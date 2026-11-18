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

    func applicationDidFinishLaunching(_ notification: Notification) {
        let www = Bundle.main.resourceURL!.appendingPathComponent("www")
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        let host = MacEngineHost(www: www, version: version)
        // Native views (story 4951) subscribe here; one re-read per burst
        rereads = ChangeCoalescer {}
        host.onChange = { [weak self] in self?.rereads?.notify() }
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

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag, let window { lifecycle.reopen(window) }
        return true
    }

    func applicationDidBecomeActive(_ notification: Notification) { lifecycle.didBecomeActive() }
    func applicationDidResignActive(_ notification: Notification) { lifecycle.didResignActive() }
    @objc private func willSleep() { lifecycle.willSleep() }
    @objc private func didWake() { lifecycle.didWake() }

    func windowShouldClose(_ sender: NSWindow) -> Bool { lifecycle.windowShouldClose(sender) }

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
