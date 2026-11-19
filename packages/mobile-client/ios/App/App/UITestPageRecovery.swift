#if DEBUG
import UIKit
import WebKit

// Test-only (sc-5247). With `-UITestPageDeaths N`, the app reports N ends of
// the page's process to its real recovery path, and writes on screen where the
// web view was before and right after, for PageRecoveryUITests to read. With
// `-UITestPageStartPath`, it first moves the page there: a stand-in for a
// one-time sign-in callback. Every address the web view shows is also appended
// to tmp/page-addresses.log, for a check that ends the real process from
// outside. Debug builds only.
@MainActor
enum UITestPageRecovery {
    private static var deaths: Int { UserDefaults.standard.integer(forKey: "UITestPageDeaths") }
    private static var deathDelay: Double { UserDefaults.standard.double(forKey: "UITestPageDeathDelay") }
    private static var startPath: String? { UserDefaults.standard.string(forKey: "UITestPageStartPath") }
    private static var observation: NSKeyValueObservation?

    static func startIfRequested(webView: WKWebView, delegate: PageProcessDelegate, serverURL: URL) {
        guard deaths > 0 || startPath != nil else { return }
        let log = FileManager.default.temporaryDirectory.appendingPathComponent("page-addresses.log")
        try? Data().write(to: log)
        observation = webView.observe(\.url, options: [.initial]) { webView, _ in
            MainActor.assumeIsolated { append(address(webView), to: log) }
        }
        Task {
            await settle(webView)
            if let startPath, let url = URL(string: serverURL.absoluteString + startPath) {
                webView.load(URLRequest(url: url))
                await settle(webView)
            }
            guard deaths > 0 else {
                show("ready", identifier: "uiTestPageRecoveryReady", in: webView)
                return
            }
            // Time for a test to open a budget first (sc-5220's screenshots)
            try? await Task.sleep(nanoseconds: UInt64(deathDelay * 1_000_000_000))
            let before = address(webView)
            var after = ""
            for _ in 0..<deaths {
                delegate.webViewWebContentProcessDidTerminate(webView)
                // Read at once: the page's own router can move on after it loads
                after = address(webView)
                await settle(webView)
            }
            show("before=\(before) after=\(after)", identifier: "uiTestPageRecovery", in: webView)
            if UserDefaults.standard.bool(forKey: "UITestPageNoticeSheet") { presentSheet(over: webView) }
        }
    }

    // `-UITestPageNoticeSheet`: a sheet with a top bar, opened while the notice
    // shows (sc-5220), as the person would open a transaction to check it
    private static func presentSheet(over webView: WKWebView) {
        guard var top = webView.window?.rootViewController else { return }
        while let next = top.presentedViewController { top = next }
        let content = UIViewController()
        content.view.backgroundColor = .systemBackground
        content.title = "Sheet"
        content.navigationItem.leftBarButtonItem = UIBarButtonItem(systemItem: .cancel, primaryAction: UIAction { [weak content] _ in
            content?.dismiss(animated: false)
        })
        content.navigationItem.leftBarButtonItem?.accessibilityIdentifier = "uiTestSheet.cancel"
        top.present(UINavigationController(rootViewController: content), animated: false)
    }

    private static func append(_ line: String, to log: URL) {
        guard let handle = try? FileHandle(forWritingTo: log) else { return }
        defer { try? handle.close() }
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: Data((line + "\n").utf8))
    }

    private static func address(_ webView: WKWebView) -> String {
        guard let url = webView.url else { return "none" }
        return url.path + (url.query.map { "?" + $0 } ?? "")
    }

    private static func settle(_ webView: WKWebView) async {
        for _ in 0..<200 {
            try? await Task.sleep(nanoseconds: 100_000_000)
            if !webView.isLoading && webView.url != nil { return }
        }
    }

    // At the bottom of the screen, clear of the notice strip
    private static func show(_ text: String, identifier: String, in webView: WKWebView) {
        // With a delay the run is for looking at the screen, so nothing is added to it
        guard let window = webView.window, deathDelay == 0 else { return }
        let label = UILabel(frame: CGRect(x: 0, y: window.bounds.height - 80, width: window.bounds.width, height: 40))
        label.text = text
        label.numberOfLines = 2
        label.font = .systemFont(ofSize: 10)
        label.backgroundColor = .systemBackground
        label.accessibilityIdentifier = identifier
        window.addSubview(label)
    }
}

// Test-only (sc-5219 task 3.4, design D12): the iPhone kill tests. With
// `-UITestKill <mode>` the app does one step against a local test budget and
// writes the outcome to Documents/kill/, for packages/mobile-client/ios/kill-tests
// to read from the Mac side, which then ends this simulator's page process:
//   write:<name>    creates a category and asks native/persisted (kill on "stored")
//   control:<name>  the same with the page bridge's barrier off (FORK_TEST_HOOKS build)
//   bulk            creates categories one after another until killed (mid-write)
//   read            lists the test categories and exports the budget
// Debug builds only.
@MainActor
enum UITestKillWrites {
    private static var mode: String? { UserDefaults.standard.string(forKey: "UITestKill") }
    private static let folder = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("kill")

    static func startIfRequested(webView: WKWebView, serverURL: URL) {
        guard let mode else { return }
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let page = PageCall(runner: webView, serverURL: serverURL)
        Task {
            do {
                write("progress", "started \(mode)")
                try await openTestBudget(page)
                write("progress", "budget open")
                try await run(mode, page)
                write("progress", "done \(mode)")
            } catch {
                write("error", "\(error)")
            }
        }
    }

    // The same local test budget every launch: created once, its id kept beside the results
    private static func openTestBudget(_ page: PageCall) async throws {
        try await waitFor { (try? await page.run("return typeof window.$send")) as? String == "function" }
        let idFile = folder.appendingPathComponent("budget-id")
        if let id = try? String(contentsOf: idFile, encoding: .utf8) {
            // The reloaded page may reopen it on its own
            for _ in 0..<50 {
                if (try? await page.run("return (await window.$send('load-prefs'))?.id ?? null;")) as? String == id { return }
                try await Task.sleep(nanoseconds: 200_000_000)
            }
            _ = try await page.run("await window.$send('load-budget', { id }); return 'ok';", arguments: ["id": id])
            return
        }
        _ = try await page.run("await window.$send('create-budget', { testMode: true }); return 'ok';")
        let id = try await page.run("return (await window.$send('load-prefs')).id;") as? String ?? ""
        try id.write(to: idFile, atomically: true, encoding: .utf8)
    }

    private static func run(_ mode: String, _ page: PageCall) async throws {
        let createAndAsk = """
            const cats = await window.$send('get-categories');
            const group = cats.grouped.find(g => !g.is_income);
            await window.$send('category-create', { name, groupId: group.id });
            return await window.__actualNativeBridge.call('native/persisted');
            """
        if mode.hasPrefix("write:") || mode.hasPrefix("control:") {
            let name = String(mode.split(separator: ":", maxSplits: 1)[1])
            if mode.hasPrefix("control:") { _ = try await page.run("window.__forkTestBarrierOff = true; return 'ok';") }
            let answer = try await page.run(createAndAsk, arguments: ["name": name]) as? String ?? ""
            write("result-\(name)", answer)
        } else if mode == "bulk" {
            write("bulk-started", "")
            _ = try await page.run(
                """
                const cats = await window.$send('get-categories');
                const group = cats.grouped.find(g => !g.is_income);
                for (let i = 0; i < 2000; i++) {
                  await window.$send('category-create', { name: 'bulk-' + i, groupId: group.id });
                }
                return 'done';
                """)
            write("bulk-done", "")
        } else if mode == "read" {
            let read = try await page.run(
                """
                const cats = await window.$send('get-categories');
                const names = cats.list.map(c => c.name).filter(n => n.startsWith('kill-') || n.startsWith('control-'));
                const bulk = cats.list.filter(c => c.name.startsWith('bulk-')).length;
                const exported = await window.$send('export-budget');
                const bytes = new Uint8Array(exported.data ?? []);
                let text = '';
                for (let i = 0; i < bytes.length; i += 0x8000) {
                  text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
                }
                return JSON.stringify({ names, bulk, error: exported.error ?? null, zip: btoa(text) });
                """) as? String ?? ""
            write("read", read)
        }
    }

    private static func write(_ name: String, _ text: String) {
        try? text.write(to: folder.appendingPathComponent("\(name).json"), atomically: true, encoding: .utf8)
    }

    private static func waitFor(_ condition: () async -> Bool) async throws {
        for _ in 0..<300 {
            if await condition() { return }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        throw CancellationError()
    }
}
#endif
