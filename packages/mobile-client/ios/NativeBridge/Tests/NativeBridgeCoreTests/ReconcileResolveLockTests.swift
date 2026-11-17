import Foundation
import XCTest

@testable import NativeBridgeCore

// native-reconcile-resolve-and-lock (sc-4825, task 2.1): steps 3 and 4 against
// a fake page and loot-core's fixtures. Swift reads, sends a typed write and
// reads again; every difference and row set is loot-core's.
private let fixturesDir = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("loot-core/src/server/native/fixtures")

private func json(_ name: String) throws -> String {
    String(decoding: try Data(contentsOf: fixturesDir.appendingPathComponent("\(name).json")), as: UTF8.self)
}

private func canonical(_ data: Data) throws -> String {
    func strip(_ value: Any) -> Any {
        if let dict = value as? [String: Any] { return dict.filter { !($0.value is NSNull) }.mapValues(strip) }
        if let array = value as? [Any] { return array.map(strip) }
        return value
    }
    let object = strip(try JSONSerialization.jsonObject(with: data))
    return String(decoding: try JSONSerialization.data(withJSONObject: object, options: .sortedKeys), as: UTF8.self)
}

private struct Boom: Error {}

@MainActor
private final class FakeLockPage {
    var calls: [(name: String, args: String)] = []
    var results: [String: String] = [:]
    var failures: [String: Error] = [:]

    init() throws {
        results = [
            "native/reconcile-matches": try json("reconcile-matches"),
            "native/reconcile-rows": try json("reconcile-rows"),
            "native/reconcile-lock-preview": try json("reconcile-lock-preview"),
            "native/reconcile-tick": #"{"statement":95000,"cleared":95000,"difference":0}"#,
            "native/reconcile-adjust": #"{"id":"adj","summary":{"statement":95000,"cleared":95000,"difference":0}}"#,
            "native/reconcile-lock": #"{"locked_ids":["a","b"],"linked_ids":[],"verified":true,"cleared":95000,"difference":0}"#,
        ]
    }

    var client: NativeBridgeClient {
        NativeBridgeClient(timeout: 1) { name, args in
            try await MainActor.run {
                self.calls.append((name, args))
                if let failure = self.failures[name] { throw failure }
                return self.results[name] ?? "null"
            }
        }
    }

    func args(_ name: String) -> [String] { calls.filter { $0.name == name }.map(\.args) }
}

final class ReconcileResolveLockContractTests: XCTestCase {
    func testDecodesTheMatchesAndPreviewFixtures() throws {
        let matchesData = Data(try json("reconcile-matches").utf8)
        let matches = try JSONDecoder().decode(ReconcileMatches.self, from: matchesData)
        XCTAssertEqual(matches.matches.map(\.kind), [.tickOne, .tickOne, .tickTwo, .untickOne])
        XCTAssertEqual(matches.addAmountParam, "-41.80")
        // The shared Transaction row's fields (PR 403 design review)
        XCTAssertEqual(matches.matches[0].rows.first?.payee, "Grocer")
        XCTAssertEqual(matches.matches[0].rows.first?.date, "2016-12-20")
        XCTAssertEqual(try canonical(JSONEncoder().encode(matches)), try canonical(matchesData))

        let previewData = Data(try json("reconcile-lock-preview").utf8)
        let preview = try JSONDecoder().decode(ReconcileLockPreview.self, from: previewData)
        XCTAssertEqual(preview.count, 3)
        XCTAssertEqual(preview.partners.map(\.id), ["xfer-b"])
        XCTAssertEqual(try canonical(JSONEncoder().encode(preview)), try canonical(previewData))
    }
}

@MainActor
final class ReconcileResolveViewModelTests: XCTestCase {
    private func model(_ page: FakeLockPage) -> ReconcileResolveViewModel {
        ReconcileResolveViewModel(client: page.client, accountId: "checking", accountName: "Joint Checking", changeInterval: 0.001)
    }

    func testLoadsTheMatchesAndKeepsThemWhenAReReadFails() async throws {
        let page = try FakeLockPage()
        let model = model(page)
        await model.load()
        XCTAssertEqual(model.difference, 4180)
        XCTAssertEqual(model.matches.count, 4)
        page.failures["native/reconcile-matches"] = NativeBridgeError.timedOut("native/reconcile-matches")
        await model.load()
        guard case .stale(let read, .timedOut) = model.state else { return XCTFail("\(model.state)") }
        XCTAssertEqual(read.matches.count, 4)
    }

    func testAMatchTicksItsRowsAndReachesZero() async throws {
        let page = try FakeLockPage()
        let model = model(page)
        await model.load()
        var zero = try JSON(page.results["native/reconcile-matches"]!)
        zero["difference"] = 0
        zero["matches"] = []
        zero["add_amount_param"] = NSNull()
        page.results["native/reconcile-matches"] = zero.text
        await model.apply(model.matches[2])
        let tick = try XCTUnwrap(page.args("native/reconcile-tick").first)
        XCTAssertTrue(tick.contains(#""ids":["pair-b","pair-a"]"#) && tick.contains(#""cleared":true"#), tick)
        XCTAssertTrue(model.reachedZero)
    }

    func testAnUntickMatchUnticks() async throws {
        let page = try FakeLockPage()
        let model = model(page)
        await model.load()
        await model.apply(model.matches[3])
        XCTAssertTrue(try XCTUnwrap(page.args("native/reconcile-tick").first).contains(#""cleared":false"#))
    }

    func testSearchKeepsTheLastResults() async throws {
        let page = try FakeLockPage()
        let model = model(page)
        await model.search("41.80")
        XCTAssertEqual(page.args("native/reconcile-rows"), [#"{"account_id":"checking","scope":"all","search":"41.80"}"#])
        XCTAssertEqual(model.searchResults.read?.rows.count, 2)
        page.failures["native/reconcile-rows"] = Boom()
        await model.search("41.8")
        XCTAssertEqual(model.searchResults.read?.rows.count, 2)
        // Over 100 characters is never sent
        await model.search(String(repeating: "x", count: 101))
        XCTAssertEqual(page.args("native/reconcile-rows").count, 2)
    }

    func testTheAddPathCarriesLootCoresAmountAndTheAccountName() async throws {
        let page = try FakeLockPage()
        let model = model(page)
        await model.load()
        XCTAssertEqual(model.addPath, "/transactions/new?account=Joint%20Checking&amount=-41.80")
    }

    func testAnAdjustmentSendsTheDifferenceAndKeepsItsToken() async throws {
        let page = try FakeLockPage()
        let model = model(page)
        await model.load()
        let added = await model.adjust(categoryId: nil, label: "Reconciliation balance adjustment")
        XCTAssertTrue(added)
        let sent = try XCTUnwrap(page.args("native/reconcile-adjust").first)
        XCTAssertTrue(sent.contains(#""amount":4180"#) && !sent.contains("category_id"), sent)
        XCTAssertNotNil(model.adjustmentToken)
    }

    func testAStaleAdjustmentFailsAndSaysSo() async throws {
        let page = try FakeLockPage()
        page.failures["native/reconcile-adjust"] = Boom()
        let model = model(page)
        await model.load()
        let added = await model.adjust(categoryId: "c", label: "Adjustment")
        XCTAssertFalse(added)
        XCTAssertEqual(model.error, .adjustFailed)
        XCTAssertNil(model.adjustmentToken)
    }
}

@MainActor
final class ReconcileLockViewModelTests: XCTestCase {
    func testLocksWithThePreviewsDigest() async throws {
        let page = try FakeLockPage()
        let model = ReconcileLockViewModel(client: page.client, accountId: "checking", changeInterval: 0.001)
        await model.load()
        XCTAssertEqual(model.state.read?.count, 3)
        let done = await model.lock()
        XCTAssertTrue(done)
        XCTAssertEqual(
            page.args("native/reconcile-lock"),
            [#"{"account_id":"checking","plan_digest":"61dce30d2d19cb46ddad1c5f2142de1b0d85b037771bdea55b7f5a88d17c5916"}"#])
        XCTAssertEqual(model.result?.verified, true)
    }

    func testAnUnverifiedLockIsAResultNotAnError() async throws {
        let page = try FakeLockPage()
        page.results["native/reconcile-lock"] = #"{"locked_ids":["a"],"linked_ids":[],"verified":false,"cleared":94000,"difference":1000}"#
        let model = ReconcileLockViewModel(client: page.client, accountId: "checking", changeInterval: 0.001)
        await model.load()
        let done = await model.lock()
        XCTAssertTrue(done)
        XCTAssertEqual(model.result?.verified, false)
        XCTAssertNil(model.error)
    }

    func testARefusedLockReadsAgainAndSaysSo() async throws {
        let page = try FakeLockPage()
        page.failures["native/reconcile-lock"] = Boom()
        let model = ReconcileLockViewModel(client: page.client, accountId: "checking", changeInterval: 0.001)
        await model.load()
        let done = await model.lock()
        XCTAssertFalse(done)
        XCTAssertEqual(model.error, .lockFailed)
        XCTAssertEqual(page.args("native/reconcile-lock-preview").count, 2)
    }

    func testRemovesTheAdjustmentWithItsToken() async throws {
        let page = try FakeLockPage()
        let model = ReconcileLockViewModel(client: page.client, accountId: "checking", changeInterval: 0.001)
        await model.load()
        let removed = await model.removeAdjustment(token: "A")
        XCTAssertTrue(removed)
        XCTAssertEqual(page.args("native/undo"), [#"{"token":"A"}"#])
    }

    func testCoalescesReReads() async throws {
        let page = try FakeLockPage()
        let model = ReconcileLockViewModel(client: page.client, accountId: "checking", changeInterval: 0.001)
        await model.load()
        model.eventReceived("sync-event", tables: ["transactions"])
        model.eventReceived("sync-event", tables: ["accounts"])
        try await waitUntil("re-read") { page.args("native/reconcile-lock-preview").count == 2 }
        for _ in 0..<50 { await Task.yield() }
        XCTAssertEqual(page.args("native/reconcile-lock-preview").count, 2)
    }
}

// A fixture's JSON, edited in a test
private struct JSON {
    var object: [String: Any]

    init(_ text: String) throws { object = try JSONSerialization.jsonObject(with: Data(text.utf8)) as! [String: Any] }

    subscript(key: String) -> Any? {
        get { object[key] }
        set { object[key] = newValue }
    }

    var text: String { String(decoding: try! JSONSerialization.data(withJSONObject: object), as: UTF8.self) }
}
