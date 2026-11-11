#if DEBUG
import UIKit
import WebKit

// Fork-only (sc-3584). The bridge spike's benchmark; Debug builds only. Start
// it with the launch argument `-NativeBridgeBenchmark YES`, for example
// `xcrun simctl launch --console-pty <device> <bundle id> -NativeBridgeBenchmark YES`.
// It opens (or seeds) a 300-category budget through the page's debug `$send`,
// times `native/budget-month` round trips with the WebView visible and hidden,
// checks change events, and probes the bridge across background and
// foreground. Each result is one stdout line starting with NATIVE_BRIDGE_BENCH.
@MainActor
final class NativeBridgeBenchmark {
    private static var current: NativeBridgeBenchmark?

    static func startIfRequested(plugin: NativeBridgePlugin) {
        guard UserDefaults.standard.bool(forKey: "NativeBridgeBenchmark") else { return }
        let bench = NativeBridgeBenchmark(plugin: plugin)
        current = bench
        Task { await bench.run() }
    }

    private let plugin: NativeBridgePlugin
    private var events = 0
    private var rereads = 0
    private var ticksAtBackground = 0
    private var backgroundedAt = Date()
    private let month: String = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM"
        return f.string(from: Date())
    }()

    private init(plugin: NativeBridgePlugin) {
        self.plugin = plugin
    }

    private var webView: WKWebView? { plugin.bridge?.webView }

    private func log(_ step: String, _ fields: [String: Any]) {
        var all = fields
        all["step"] = step
        let data = (try? JSONSerialization.data(withJSONObject: all, options: .sortedKeys)) ?? Data()
        print("NATIVE_BRIDGE_BENCH \(String(decoding: data, as: UTF8.self))")
        fflush(stdout)  // stdout is a file under `simctl launch --stdout`, so fully buffered
    }

    private func js(_ body: String) async throws -> Any? {
        try await webView?.callAsyncJavaScript(body, arguments: [:], contentWorld: .page)
    }

    func run() async {
        do {
            try await waitForPage()
            log("seed", try await js(Self.seedScript) as? [String: Any] ?? [:])
            plugin.onEvent = { [weak self] _ in self?.events += 1 }
            plugin.onChange = { [weak self] in
                guard let self else { return }
                self.rereads += 1
                Task { _ = try? await self.plugin.client.budgetMonth(self.month) }
            }
            try await measure("visible", count: 50)
            try await pageOnly(count: 50)
            try await changeEvents("visible")

            webView?.isHidden = true
            try await measure("hidden", count: 50)
            try await changeEvents("hidden")
            webView?.isHidden = false

            _ = try await js("window.__benchTicks = 0; setInterval(() => window.__benchTicks++, 100); return 0")
            observeLifecycle()
            log("ready-for-background", [:])
        } catch {
            log("error", ["message": String(describing: error)])
        }
    }

    private func waitForPage() async throws {
        for _ in 0..<240 {
            let ready = try? await js("return typeof window.$send === 'function' && !!window.__actualNativeBridge") as? Bool
            if ready == true {
                log("page-ready", ["origin": (try? await js("return location.origin")) as? String ?? "?"])
                return
            }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        throw NativeBridgeError.noPage
    }

    private func roundTrip() async throws -> (ms: Double, categories: Int) {
        let start = DispatchTime.now().uptimeNanoseconds
        let result = try await plugin.client.budgetMonth(month)
        let ms = Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000
        return (ms, result.groups.reduce(0) { $0 + $1.categories.count })
    }

    private func measure(_ step: String, count: Int) async throws {
        for _ in 0..<5 { _ = try await roundTrip() }  // warm-up
        var times: [Double] = []
        var categories = 0
        for _ in 0..<count {
            let (ms, n) = try await roundTrip()
            times.append(ms)
            categories = n
        }
        let bytes = try await plugin.client.call("native/budget-month", args: ["month": month]).count
        log(step, Self.stats(times).merging(["categories": categories, "bytes": bytes]) { a, _ in a })
    }

    // The same call timed inside the page: loot-core plus the worker hop, no WebKit bridge
    private func pageOnly(count: Int) async throws {
        let times = try await js("""
            const out = [];
            for (let i = 0; i < \(count + 5); i++) {
              const t = performance.now();
              await window.__actualNativeBridge.call('native/budget-month', { month: '\(month)' });
              out.push(performance.now() - t);
            }
            return out.slice(5);
            """) as? [Double] ?? []
        log("page-only", Self.stats(times))
    }

    // Five budget writes from the web side in one burst
    private func changeEvents(_ step: String) async throws {
        events = 0
        rereads = 0
        _ = try await js("""
            const { list } = await window.$send('get-categories');
            const cats = list.filter(c => !c.is_income).slice(0, 5);
            await Promise.all(cats.map((c, i) => window.$send('budget/budget-amount',
              { month: '\(month)', category: c.id, amount: Math.floor(Math.random() * 100000) + i })));
            return cats.length;
            """)
        try await Task.sleep(nanoseconds: 1_000_000_000)
        log("events-\(step)", ["events": events, "rereads": rereads])
    }

    private func observeLifecycle() {
        let center = NotificationCenter.default
        center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in await self?.didEnterBackground() }
        }
        center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in await self?.willEnterForeground() }
        }
    }

    private func didEnterBackground() async {
        backgroundedAt = Date()
        ticksAtBackground = (try? await js("return window.__benchTicks")) as? Int ?? -1
        log("background", ["ticks": ticksAtBackground])
        // Probe within the background grace period, with and without a task assertion
        let task = UIApplication.shared.beginBackgroundTask(withName: "bridge-probe")
        for i in 0..<5 {
            let started = Date()
            do {
                let (ms, _) = try await roundTrip()
                log("background-probe", ["i": i, "ms": ms])
            } catch {
                log("background-probe", ["i": i, "error": String(describing: error),
                                         "afterMs": Date().timeIntervalSince(started) * 1000])
            }
            try? await Task.sleep(nanoseconds: 2_000_000_000)
        }
        UIApplication.shared.endBackgroundTask(task)
    }

    private func willEnterForeground() async {
        let away = Date().timeIntervalSince(backgroundedAt)
        let ticks = (try? await js("return window.__benchTicks")) as? Int ?? -1
        log("foreground", ["awaySeconds": away, "ticksWhileAway": ticks - ticksAtBackground,
                           "ticksExpected": Int(away * 10)])
        do {
            try await measure("after-foreground", count: 20)
            try await changeEvents("after-foreground")
        } catch {
            log("error", ["message": String(describing: error)])
        }
    }

    private static func stats(_ times: [Double]) -> [String: Any] {
        let sorted = times.sorted()
        guard !sorted.isEmpty else { return ["n": 0] }
        func pct(_ p: Double) -> Double { sorted[min(sorted.count - 1, Int(Double(sorted.count) * p))] }
        return ["n": sorted.count, "medianMs": pct(0.5), "p95Ms": pct(0.95),
                "minMs": sorted.first!, "maxMs": sorted.last!]
    }

    // Opens the "Bridge Benchmark" budget, creating it with 300 expense
    // categories (10 groups of 30) and budget amounts on first launch. On a
    // later launch `existed` is true: the budget persisted across a restart.
    private static let seedScript = """
        const name = 'Bridge Benchmark';
        const month = new Date().toISOString().slice(0, 7);
        const started = performance.now();
        const budgets = await window.$send('get-budgets');
        const found = budgets.find(b => b.name === name);
        if (found) {
          await window.$send('load-budget', { id: found.id });
        } else {
          await window.$send('create-budget', { budgetName: name, avoidUpload: true });
        }
        let { list } = await window.$send('get-categories');
        let expense = list.filter(c => !c.is_income);
        for (let g = 0; expense.length < 300; g++) {
          const groupId = await window.$send('category-group-create', { name: 'Bench group ' + g });
          for (let i = 0; i < 30 && expense.length < 300; i++) {
            const id = await window.$send('category-create', { name: 'Bench ' + g + '-' + i, groupId });
            await window.$send('budget/budget-amount', { month, category: id, amount: 1000 * (i + 1) });
            expense.push({ id });
          }
        }
        ({ list } = await window.$send('get-categories'));
        return { existed: !!found, categories: list.length, seedMs: performance.now() - started };
        """
}
#endif
