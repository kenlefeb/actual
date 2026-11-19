#if DEBUG
import Combine
import UIKit
import WebKit

// Test-only (sc-5219, the iPhone guard flip's evidence). `-UITestGuard <mode>`
// opens the kill tests' local test budget, then writes a budget amount through
// the same client the native screens use, and writes down on screen (for
// GuardEvidenceUITests) and in Documents/guard/notes.txt what happened:
//   normal   one write: is it answered stored, and how fast
//   slow     the same on a page built with a commit delay longer than the wait
//   fail     arms the test-only storage failure (native/test-fail-storage), then
//            writes: the write's answer, the latch, a second write, a sync, and
//            after the person's Reload, a write on the new page
//   quota    the same with a full device
//   restart  a write left unconfirmed, then the page's process "ends" through
//            the real recovery path (PageProcessDelegate), as a crash would
// Every line the storage status shows is noted as it changes. Debug builds only.
@MainActor
enum UITestGuardEvidence {
    private static var mode: String? { UserDefaults.standard.string(forKey: "UITestGuard") }
    private static var notes: [String] = []
    private static var label: UILabel?
    private static var watcher: AnyCancellable?
    private static let start = Date()
    private static let file = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("guard/notes.txt")

    static func startIfRequested(
        webView: WKWebView, serverURL: URL, client: NativeBridgeClient, storage: WriteStorageStatus,
        endPageProcess: @escaping () -> Void
    ) {
        guard let mode else { return }
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        // Ours, and the kill tests' folder, where the test budget's id is kept
        for folder in ["guard", "kill"] {
            try? FileManager.default.createDirectory(at: documents.appendingPathComponent(folder), withIntermediateDirectories: true)
        }
        try? Data().write(to: file)
        let page = PageCall(runner: webView, serverURL: serverURL)
        watcher = storage.shownMessage().sink { note("storage status shows: \($0 ?? "nothing")") }
        Task {
            do {
                try await UITestKillWrites.openTestBudget(page)
                let shell = try? await page.run("return String(window.__actualNativeShell?.storageGuard)")
                note("guard: shell opted in = \(shell as? String ?? "?")")
                note("storage state: \(await storageState(page))")
                let category = try await page.run(
                    "const c = await window.$send('get-categories'); return c.list.find(x => !x.is_income && !x.hidden)?.id ?? '';"
                ) as? String ?? ""
                let month = String(ISO8601DateFormatter().string(from: Date()).prefix(7))
                func write(_ amount: Int) async -> String {
                    let began = Date()
                    do {
                        let stored = try await client.setBudgetAmount(try BudgetAmountWrite(category: category, month: month, amount: amount))
                        return "answered stored=\(stored) after \(Int(Date().timeIntervalSince(began) * 1000)) ms"
                    } catch {
                        return "refused after \(Int(Date().timeIntervalSince(began) * 1000)) ms: \(error)"
                    }
                }
                switch mode {
                case "normal", "slow":
                    note("write: \(await write(1234))")
                    try await Task.sleep(nanoseconds: 8_000_000_000)
                case "fail", "quota":
                    let armed = try? await page.run(
                        "await window.$send('native/test-fail-storage', { quota }); return 'armed';", arguments: ["quota": mode == "quota"])
                    note("storage failure \(armed as? String ?? "not armed")")
                    note("write: \(await write(2345))")
                    try await Task.sleep(nanoseconds: 3_000_000_000)
                    note("storage state: \(await storageState(page))")
                    note("second write: \(await write(3456))")
                    let sync = (try? await client.sync()).map { "\($0)" } ?? "failed"
                    note("sync: \(sync)")
                    note("waiting for Reload")
                    // The person's Reload loads a new page: wait for its engine, then write
                    for _ in 0..<240 {
                        try await Task.sleep(nanoseconds: 500_000_000)
                        if await storageState(page).contains(#""failed":false"#) { break }
                    }
                    // ...and for it to reopen the test budget
                    for _ in 0..<120 {
                        let open = try? await page.run("return (await window.$send('load-prefs'))?.id ?? '';") as? String
                        if open == "_test-budget" { break }
                        try await Task.sleep(nanoseconds: 500_000_000)
                    }
                    try await Task.sleep(nanoseconds: 1_000_000_000)
                    note("after Reload: storage state: \(await storageState(page))")
                    note("after Reload: write: \(await write(4567))")
                case "restart":
                    note("write: \(await write(5678))")
                    note("the page's process ends")
                    endPageProcess()
                    try await Task.sleep(nanoseconds: 8_000_000_000)
                default:
                    note("unknown mode \(mode)")
                }
                note("done")
            } catch {
                note("error: \(error)")
            }
        }
    }

    private static func storageState(_ page: PageCall) async -> String {
        (try? await page.run("return JSON.stringify(await window.$send('native/storage-state'));")) as? String ?? "no answer"
    }

    private static func note(_ text: String) {
        let line = String(format: "%5.1f s  ", Date().timeIntervalSince(start)) + text
        notes.append(line)
        if let handle = try? FileHandle(forWritingTo: file) {
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: Data((line + "\n").utf8))
            try? handle.close()
        }
        show(notes.suffix(6).joined(separator: "\n"))
    }

    // Small, at the bottom, clear of the strip and the dialogs, on whatever is
    // on top of the main window (where the UI test can find it)
    private static func show(_ text: String) {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        guard var top = scene?.windows.first(where: { $0.windowLevel == .normal })?.rootViewController else { return }
        while let next = top.presentedViewController { top = next }
        if label == nil || label?.superview !== top.view {
            label?.removeFromSuperview()
            let made = UILabel()
            made.numberOfLines = 0
            made.font = .monospacedSystemFont(ofSize: 9, weight: .regular)
            made.backgroundColor = UIColor.systemBackground.withAlphaComponent(0.85)
            made.accessibilityIdentifier = "uiTestGuard"
            top.view.addSubview(made)
            label = made
        }
        guard let label else { return }
        label.text = text
        label.frame = CGRect(x: 4, y: top.view.bounds.height - 200, width: top.view.bounds.width - 8, height: 110)
        label.accessibilityLabel = notes.joined(separator: "\n")
        top.view.bringSubviewToFront(label)
    }
}
#endif
