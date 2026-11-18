import Foundation
import NativeBridgeCore
import XCTest

@testable import HomeEconomicsMac

// sc-5219 (native-durable-writes D11, task 3.3): what the storage barrier adds
// to a native write, on the real engine and real WebKit IndexedDB. Timed: a
// one-row categorize through the client, with its native/storage-state check
// and native/persisted, against the same write alone with the barrier hook on.
// Runs only in the fork-mac-native gate job, which stages a web build made with
// FORK_TEST_HOOKS=true and sets HE_STORAGE_PERF_GATE=1. If it misses, stop and
// report; the limits are not loosened.
@MainActor
final class StoragePerfGateTests: XCTestCase {
    private let samples = 30
    private let warmUp = 5
    private let maxAddedMedianMs = 50.0
    private let maxAddedP95Ms = 250.0

    func testTheBarrierAddsNoMoreThanItsLimits() async throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["HE_STORAGE_PERF_GATE"] == "1", "runs in the gate job")
        // Past this point nothing skips: a gate that can't run has failed
        let www = Bundle.main.resourceURL!.appendingPathComponent("www")
        XCTAssertTrue(try holdsBarrierHook(www), "the staged web build must be made with FORK_TEST_HOOKS=true")

        let host = MacEngineHost(www: www, version: "perf-gate")
        host.load()
        let page = PageCall(runner: host.webView, serverURL: MacEngineHost.serverURL)
        try await waitFor("the page bridge") { (try? await page.run("return typeof window.__actualNativeBridge")) as? String == "object" }
        _ = try await page.run("await window.$send('create-budget', { testMode: true }); return 'ok';")
        let month = NativeBridgeBenchmark.currentMonth()
        var snapshot: BudgetMonth?
        try await waitFor("the budget") {
            snapshot = try? await host.client.budgetMonth(month)
            return snapshot != nil
        }
        let categories = try XCTUnwrap(snapshot?.expenseGroups.first?.categories.prefix(2).map(\.id))
        XCTAssertEqual(categories.count, 2)
        let (accountId, rowId) = try await plainRow(host.client)

        // The same page, without the client's storage call
        let bare = NativeBridgeClient { name, argsJSON in
            try await page.bridgeCall(name: name, argsJSON: argsJSON)
        }
        var withBarrier: [Double] = []
        var without: [Double] = []
        var next = 0
        func write(_ client: NativeBridgeClient) async throws -> Double {
            next += 1
            let change = try TransactionsCategorize(
                accountId: accountId, ids: [rowId], category: categories[next % 2], undoToken: UUID().uuidString)
            let start = DispatchTime.now().uptimeNanoseconds
            try await client.categorizeTransactions(change)
            return Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000
        }
        func timedBare() async throws -> Double {
            _ = try await page.run("window.__forkTestBarrierOff = true; return 'ok';")
            let elapsed = try await write(bare)
            _ = try await page.run("window.__forkTestBarrierOff = false; return 'ok';")
            // Not timed: the next write must not wait for this one's commit
            _ = try await page.bridgeCall(name: "native/persisted", argsJSON: "{}")
            return elapsed
        }
        // Alternating, so drift on the machine falls on both sides alike
        for round in 0..<(warmUp + samples) {
            let barrier: Double
            let plain: Double
            if round.isMultiple(of: 2) {
                barrier = try await write(host.client)
                plain = try await timedBare()
            } else {
                plain = try await timedBare()
                barrier = try await write(host.client)
            }
            if round >= warmUp {
                withBarrier.append(barrier)
                without.append(plain)
            }
        }

        let addedMedian = percentile(withBarrier, 50) - percentile(without, 50)
        let addedP95 = percentile(withBarrier, 95) - percentile(without, 95)
        print(
            String(
                format: "storage perf gate: bare median %.1f ms, p95 %.1f ms; with barrier median %.1f ms, p95 %.1f ms; "
                    + "added median %.1f ms (limit %.0f), p95 %.1f ms (limit %.0f); %d samples each",
                percentile(without, 50), percentile(without, 95), percentile(withBarrier, 50), percentile(withBarrier, 95),
                addedMedian, maxAddedMedianMs, addedP95, maxAddedP95Ms, samples))
        XCTAssertLessThanOrEqual(addedMedian, maxAddedMedianMs)
        XCTAssertLessThanOrEqual(addedP95, maxAddedP95Ms)
    }

    // The nearest-rank percentile
    private func percentile(_ values: [Double], _ percent: Int) -> Double {
        let sorted = values.sorted()
        let rank = Int((Double(percent) / 100 * Double(sorted.count)).rounded(.up))
        return sorted[max(rank - 1, 0)]
    }

    // A row a categorize can change: not a split, a transfer or reconciled
    private func plainRow(_ client: NativeBridgeClient) async throws -> (account: String, row: String) {
        let accounts = try await client.accountsList().sections.onBudget.accounts.filter { !$0.closed }
        for account in accounts {
            let register = try await client.accountRegister(AccountRegisterRequest(accountId: account.id))
            if let row = register.rows.first(where: { $0.splitCount == 0 && $0.transferAccount == nil && !$0.reconciled }) {
                return (account.id, row.id)
            }
        }
        XCTFail("the test budget has no plain row")
        throw CancellationError()
    }

    private func holdsBarrierHook(_ www: URL) throws -> Bool {
        let files = FileManager.default.enumerator(at: www, includingPropertiesForKeys: nil)
        while let file = files?.nextObject() as? URL {
            guard file.pathExtension == "js" else { continue }
            if try String(contentsOf: file, encoding: .utf8).contains("__forkTestBarrierOff") { return true }
        }
        return false
    }

    private func waitFor(_ what: String, timeout: TimeInterval = 120, _ check: () async throws -> Bool) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if try await check() { return }
            try await Task.sleep(nanoseconds: 500_000_000)
        }
        XCTFail("timed out waiting for \(what)")
        throw CancellationError()
    }
}
