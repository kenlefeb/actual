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
    // `-UITestKillLimit <seconds>`: how long a step waits for the page (default 180)
    private static var limit: Double {
        let value = UserDefaults.standard.double(forKey: "UITestKillLimit")
        return value > 0 ? value : 180
    }
    private static let folder = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("kill")

    static func startIfRequested(webView: WKWebView, serverURL: URL) {
        guard let mode else { return }
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let page = PageCall(runner: webView, serverURL: serverURL)
        // A page alert() holds the page's JavaScript, so every page call waits behind it: log its text
        Task {
            var seen = ""
            while true {
                var top = webView.window?.rootViewController
                while let next = top?.presentedViewController { top = next }
                let text = (top as? UIAlertController)?.message ?? ""
                if text != seen, !text.isEmpty { log("page alert shown: \(text)") }
                seen = text
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
        Task {
            if mode.hasPrefix("reopen:") {
                await reopen(String(mode.dropFirst("reopen:".count)), page)
                return
            }
            do {
                log("started \(mode)")
                try await openTestBudget(page)
                log("budget open")
                try await run(mode, page)
                log("done \(mode)")
            } catch {
                write("error", "\(error)")
            }
        }
    }

    // The same local test budget every launch: created once, its id kept beside the results
    // Every page call is bounded on the page's side, so a stuck engine shows as a timeout
    private static let bounded = """
        const within = (promise, ms) => Promise.race([
          promise, new Promise((_, reject) => setTimeout(() => reject(new Error('no answer in ' + ms + ' ms')), ms)),
        ]);
        """

    private static func openTestBudget(_ page: PageCall) async throws {
        log("waiting for the page's bridge")
        try await waitFor { (try? await page.run("return typeof window.$send")) as? String == "function" }
        _ = try? await page.run(
            """
            window.__killErrors = [];
            addEventListener('error', e => window.__killErrors.push(String(e.message)));
            addEventListener('unhandledrejection', e => window.__killErrors.push(String(e.reason)));
            return 'ok';
            """)
        log("page's bridge ready")
        let idFile = folder.appendingPathComponent("budget-id")
        if let id = try? String(contentsOf: idFile, encoding: .utf8) {
            // First the app's own reopening, with nothing from this test
            let start = Date()
            while Date().timeIntervalSince(start) < 60 {
                let open = try? await page.run(
                    bounded + "try { return (await within(window.$send('load-prefs'), 2000))?.id ?? 'none'; } catch (e) { return 'error: ' + e.message; }")
                if open as? String == id {
                    log("the app reopened the budget by itself after \(Int(Date().timeIntervalSince(start))) s")
                    return
                }
                if let answer = open as? String, answer.hasPrefix("error") { log("load-prefs: \(answer)") }
                try await Task.sleep(nanoseconds: 500_000_000)
            }
            log("the app did not reopen the budget in 60 s; page: \(await pageState(page))")
            let opened = try await page.run(
                bounded + "try { const r = await within(window.$send('load-budget', { id }), 90000); return r?.error ? 'error: ' + JSON.stringify(r) : 'ok'; } catch (e) { return 'error: ' + e.message; }",
                arguments: ["id": id]) as? String ?? "no answer"
            log("the test's load-budget: \(opened)")
            guard opened == "ok" else {
                log("stalled; page: \(await pageState(page))")
                throw CancellationError()
            }
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
            let start = Date()
            let answer = try await page.run(createAndAsk, arguments: ["name": name]) as? String ?? ""
            log("answered in \(Int(Date().timeIntervalSince(start) * 1000)) ms")
            write("result-\(name)", answer)
        } else if mode.hasPrefix("writes:") {
            // sc-5404: several barrier-on writes in one launch, no kill between,
            // each answer with how long it took (`writes:<count>`)
            let count = Int(mode.dropFirst("writes:".count)) ?? 5
            var rows: [String] = []
            // Unique per launch: a category name can't repeat in its group
            let launch = UUID().uuidString.prefix(6)
            for n in 1...count {
                let start = Date()
                let answer = try await page.run(createAndAsk, arguments: ["name": "series-\(launch)-\(n)"]) as? String ?? ""
                rows.append("\(n) | \(Int(Date().timeIntervalSince(start) * 1000)) ms | \(answer)")
            }
            write("writes", rows.joined(separator: "\n"))
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
                const names = cats.list.map(c => c.name).filter(n => ['kill-', 'control-', 'reopen-'].some(p => n.startsWith(p)));
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

    // `reopen:<round>`, after a kill during a held commit: does the app reopen
    // the budget by itself, how long does it take, and only then the test's own open
    private static func reopen(_ round: String, _ page: PageCall) async {
        let start = Date()
        func seconds() -> Int { Int(Date().timeIntervalSince(start)) }
        log("reopen \(round): launched")
        var bridge = -1
        while seconds() < Int(limit) {
            if (try? await page.run("return typeof window.$send")) as? String == "function" {
                bridge = seconds()
                break
            }
            try? await Task.sleep(nanoseconds: 250_000_000)
        }
        log("reopen \(round): page's bridge ready after \(bridge) s")
        let id = (try? String(contentsOf: folder.appendingPathComponent("budget-id"), encoding: .utf8)) ?? ""
        var bySelf = -1
        while bridge >= 0, seconds() < Int(limit) {
            let open = try? await page.run(
                bounded + "try { return (await within(window.$send('load-prefs'), 2000))?.id ?? 'none'; } catch (e) { return 'error: ' + e.message; }")
            if open as? String == id {
                bySelf = seconds()
                break
            }
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
        log("reopen \(round): reopened by itself after \(bySelf) s")
        var byTest = "not needed"
        if bySelf < 0, bridge >= 0 {
            byTest = (try? await page.run(
                bounded + "try { const r = await within(window.$send('load-budget', { id }), 90000); return r?.error ? 'error: ' + JSON.stringify(r) : 'ok'; } catch (e) { return 'error: ' + e.message; }",
                arguments: ["id": id])) as? String ?? "no answer"
            log("reopen \(round): the test's own open: \(byTest)")
        }
        let result: [String: Any] = [
            "bridgeSeconds": bridge, "reopenedBySelfSeconds": bySelf, "testOpen": byTest, "page": await pageState(page),
        ]
        let data = (try? JSONSerialization.data(withJSONObject: result)) ?? Data()
        write("reopen-\(round)", String(decoding: data, as: UTF8.self))
    }

    // What the page shows and any error it reported, for a stall
    private static func pageState(_ page: PageCall) async -> String {
        (try? await page.run(
            """
            return JSON.stringify({ href: location.href, title: document.title,
              text: (document.body?.innerText ?? '').slice(0, 400), errors: window.__killErrors ?? [] });
            """)) as? String ?? "page did not answer"
    }

    // Appends a timestamped line, so a stall shows where it is
    private static func log(_ line: String) {
        let file = folder.appendingPathComponent("progress.log")
        let text = ISO8601DateFormatter().string(from: Date()) + " " + line + "\n"
        if let handle = try? FileHandle(forWritingTo: file) {
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: Data(text.utf8))
            try? handle.close()
        } else {
            try? text.write(to: file, atomically: true, encoding: .utf8)
        }
        write("progress", line)
    }

    private static func write(_ name: String, _ text: String) {
        try? text.write(to: folder.appendingPathComponent("\(name).json"), atomically: true, encoding: .utf8)
    }

    private static func waitFor(_ condition: () async -> Bool) async throws {
        for _ in 0..<Int(limit * 10) {
            if await condition() { return }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        throw CancellationError()
    }
}
#endif
