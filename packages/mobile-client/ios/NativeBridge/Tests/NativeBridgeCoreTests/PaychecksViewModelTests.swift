import Foundation
import XCTest

@testable import NativeBridgeCore

// native-paychecks-screen (sc-4341): the list's view model against a fake
// page transport and the loot-core contract fixtures. Swift holds no paycheck
// logic: it reads, sends a write, and reads again.
@MainActor
private final class FakePaychecksPage {
    var calls: [(name: String, args: String)] = []
    var read: String
    var failures: [String: Error] = [:]

    init() throws { read = String(decoding: try paychecksFixture(), as: UTF8.self) }

    var client: NativeBridgeClient {
        NativeBridgeClient(timeout: 1) { name, args in
            try await MainActor.run {
                self.calls.append((name, args))
                if let failure = self.failures[name] { throw failure }
                return name == "native/schedules-paychecks" ? self.read : "null"
            }
        }
    }

    func count(_ name: String) -> Int { calls.filter { $0.name == name }.count }
    func args(_ name: String) -> [String] { calls.filter { $0.name == name }.map(\.args) }
}

private struct Boom: Error {}

@MainActor
final class PaychecksViewModelTests: XCTestCase {
    // sc-5303: "Screens say "Saved" only once the write is stored"
    func testASaveNotYetStoredOffersUndoAndSaysSavedOnlyOnceStored() async throws {
        let model = model(try FakePaychecksPage())
        await model.wrote(PaychecksUndoOffer(token: "t", paycheckName: "Pay", date: "", action: .save, isStored: false))
        XCTAssertEqual(model.undoOffer?.token, "t")
        XCTAssertEqual(model.undoOffer?.isStored, false)
        XCTAssertNil(model.announcement)
        model.stored(token: "t")
        XCTAssertEqual(model.undoOffer?.isStored, true)
        XCTAssertEqual(model.announcement, "Saved Pay. Undo is available.")
    }

    // Security on PR #496: no wait outlives the list that started it
    func testAPendingWaitEndsWhenTheListGoesAway() async throws {
        final class Ended: @unchecked Sendable { var value = false }
        let ended = Ended()
        var model: PaychecksViewModel? = model(try FakePaychecksPage())
        model?.pending(token: "t") {
            await withTaskCancellationHandler {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                return true
            } onCancel: {
                ended.value = true
            }
        }
        try await Task.sleep(nanoseconds: 20_000_000)
        model = nil
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertTrue(ended.value)
    }

    func testAStoredAnswerForAnOfferThatHasGoneChangesNothing() async throws {
        let model = model(try FakePaychecksPage())
        await model.wrote(PaychecksUndoOffer(token: "t", paycheckName: "Pay", date: "", action: .create, isStored: false))
        await model.wrote(PaychecksUndoOffer(token: "u", paycheckName: "Rent", date: "", action: .delete))
        model.stored(token: "t")
        XCTAssertEqual(model.undoOffer?.token, "u")
        XCTAssertEqual(model.announcement, "Deleted Rent. Undo is available.")
    }

    private func model(_ page: FakePaychecksPage, undoFor interval: TimeInterval = 60) -> PaychecksViewModel {
        PaychecksViewModel(client: page.client, undoInterval: interval, changeInterval: 0.001)
    }

    private func fixture() throws -> SchedulesPaychecks {
        try JSONDecoder().decode(SchedulesPaychecks.self, from: paychecksFixture())
    }

    func testLoadsWhatLootCoreSent() async throws {
        let page = try FakePaychecksPage()
        let model = model(page)
        XCTAssertEqual(model.state, .loading)
        await model.load()
        XCTAssertEqual(model.state, .loaded(try fixture()))
        XCTAssertEqual(page.args("native/schedules-paychecks"), ["{}"])
    }

    func testAFailedFirstReadShowsTheError() async throws {
        let page = try FakePaychecksPage()
        page.failures["native/schedules-paychecks"] = Boom()
        let model = model(page)
        await model.load()
        XCTAssertEqual(model.state, .failed(.other))
    }

    func testAFailedOrTimedOutReReadKeepsTheLastValues() async throws {
        let page = try FakePaychecksPage()
        let model = model(page)
        await model.load()
        page.failures["native/schedules-paychecks"] = NativeBridgeError.timedOut("native/schedules-paychecks")
        await model.load()
        XCTAssertEqual(model.state, .stale(try fixture(), .timedOut))
        page.failures["native/schedules-paychecks"] = Boom()
        await model.load()
        XCTAssertEqual(model.state, .stale(try fixture(), .other))
        page.failures = [:]
        await model.load()
        XCTAssertEqual(model.state, .loaded(try fixture()))
    }

    func testReReadsOnceForABurstOfMatchingSyncEvents() async throws {
        let page = try FakePaychecksPage()
        let model = model(page)
        await model.load()
        for table in ["paychecks", "schedules", "transactions"] {
            model.eventReceived("sync-event", tables: [table])
        }
        try await waitUntil("one re-read") { page.count("native/schedules-paychecks") == 2 }
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertEqual(page.count("native/schedules-paychecks"), 2)
    }

    func testIgnoresEventsThatTouchNothingItShows() async throws {
        let page = try FakePaychecksPage()
        let model = model(page)
        await model.load()
        model.eventReceived("sync-event", tables: ["categories"])
        model.eventReceived("sync-event", tables: [])
        model.eventReceived("cells-changed", tables: [])
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertEqual(page.count("native/schedules-paychecks"), 1)
    }

    func testReReadsOnForegroundAndNotInTheBackground() async throws {
        let page = try FakePaychecksPage()
        let model = model(page)
        await model.load()
        await model.setSceneActive(false)
        model.eventReceived("sync-event", tables: ["schedules"])
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertEqual(page.count("native/schedules-paychecks"), 1)
        await model.setSceneActive(true)
        XCTAssertEqual(page.count("native/schedules-paychecks"), 2)
    }

    func testSkipSendsTheIdWithAFreshTokenThenReReads() async throws {
        let page = try FakePaychecksPage()
        let model = model(page)
        await model.load()
        let first = await model.skipNext("acme")
        let second = await model.skipNext("acme")
        XCTAssertTrue(first && second)
        let sent = try page.args("paycheck-skip-next").map {
            try JSONDecoder().decode([String: String].self, from: Data($0.utf8))
        }
        XCTAssertEqual(sent.map { $0["id"] }, ["acme", "acme"])
        XCTAssertNotEqual(sent[0]["undoToken"], sent[1]["undoToken"])
        XCTAssertEqual(page.count("native/schedules-paychecks"), 3)
        XCTAssertEqual(model.undoOffer?.token, sent[1]["undoToken"])
        XCTAssertEqual(model.undoOffer?.date, "2026-11-13")
    }

    func testAFailedSkipShowsAnErrorAndKeepsTheList() async throws {
        let page = try FakePaychecksPage()
        let model = model(page)
        await model.load()
        page.failures["paycheck-skip-next"] = NativeBridgeError.timedOut("paycheck-skip-next")
        let skipped = await model.skipNext("acme")
        XCTAssertFalse(skipped)
        XCTAssertEqual(model.actionError, .skipTimedOut)
        XCTAssertEqual(model.state, .loaded(try fixture()))
        XCTAssertNil(model.undoOffer)
        XCTAssertEqual(page.count("native/schedules-paychecks"), 1)
    }

    func testTheUndoOfferSurvivesASyncWithNoChangedTables() async throws {
        let page = try FakePaychecksPage()
        let model = model(page)
        await model.load()
        _ = await model.skipNext("acme")
        model.eventReceived("sync-event", tables: [])  // start
        model.eventReceived("sync-event", tables: [])  // success
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertNotNil(model.undoOffer)
    }

    func testTheUndoOfferIsWithdrawnWhenSomethingElseChanges() async throws {
        let page = try FakePaychecksPage()
        let model = model(page)
        await model.load()
        _ = await model.skipNext("acme")
        model.eventReceived("sync-event", tables: ["schedules"])
        XCTAssertNil(model.undoOffer)
    }

    func testTheUndoOfferTimesOut() async throws {
        let page = try FakePaychecksPage()
        let model = model(page, undoFor: 0.01)
        await model.load()
        _ = await model.skipNext("acme")
        XCTAssertNotNil(model.undoOffer)
        try await waitUntil("the offer times out", limit: 100_000) { model.undoOffer == nil }
    }

    func testTheUndoOfferIsWithdrawnOnLeavingTheScreen() async throws {
        let page = try FakePaychecksPage()
        let model = model(page)
        await model.load()
        _ = await model.skipNext("acme")
        model.leave()
        XCTAssertNil(model.undoOffer)
    }

    func testAnotherWriteWithdrawsTheOfferBeforeItIsSent() async throws {
        let page = try FakePaychecksPage()
        let model = model(page)
        await model.load()
        _ = await model.skipNext("acme")
        let first = model.undoOffer?.token
        page.failures["paycheck-skip-next"] = Boom()
        _ = await model.skipNext("acme")
        XCTAssertNil(model.undoOffer)
        XCTAssertNotNil(first)
    }

    func testUndoSendsTheOfferedTokenThenReReads() async throws {
        let page = try FakePaychecksPage()
        let model = model(page)
        await model.load()
        _ = await model.skipNext("acme")
        let token = try XCTUnwrap(model.undoOffer?.token)
        await model.undo()
        XCTAssertEqual(page.args("native/undo"), [#"{"token":"\#(token)"}"#])
        XCTAssertEqual(page.count("native/schedules-paychecks"), 3)
        XCTAssertNil(model.undoOffer)
        XCTAssertNil(model.actionError)
        XCTAssertEqual(model.announcement, NSLocalizedString("Skip undone.", comment: ""))
    }

    func testARefusedOrTimedOutUndoShowsAnErrorAndKeepsTheValues() async throws {
        for (failure, expected) in [
            (Boom() as Error, PaychecksActionError.undoFailed),
            (NativeBridgeError.timedOut("native/undo"), PaychecksActionError.undoTimedOut),
        ] {
            let page = try FakePaychecksPage()
            let model = model(page)
            await model.load()
            _ = await model.skipNext("acme")
            page.failures["native/undo"] = failure
            await model.undo()
            XCTAssertEqual(model.actionError, expected)
            XCTAssertNil(model.undoOffer)
            XCTAssertEqual(model.state, .loaded(try fixture()))
            XCTAssertEqual(page.count("native/schedules-paychecks"), 2)
        }
    }

    func testUndoWithoutAnOfferSendsNothing() async throws {
        let page = try FakePaychecksPage()
        let model = model(page)
        await model.load()
        await model.undo()
        XCTAssertEqual(page.count("native/undo"), 0)
    }

    func testHidesCompletedSchedulesUntilAsked() async throws {
        let page = try FakePaychecksPage()
        var object = try JSONSerialization.jsonObject(with: Data(page.read.utf8)) as! [String: Any]
        var schedules = object["schedules"] as! [[String: Any]]
        var done = schedules[0]
        done["id"] = "done"
        done["completed"] = true
        done["status"] = "completed"
        schedules.append(done)
        object["schedules"] = schedules
        page.read = String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
        let model = model(page)
        await model.load()
        XCTAssertEqual(model.visibleSchedules.map(\.id), ["rent"])
        XCTAssertTrue(model.hasCompletedSchedules)
        model.showCompleted = true
        XCTAssertEqual(model.visibleSchedules.map(\.id), ["rent", "done"])
    }
}

final class PaychecksSwitchTests: XCTestCase {
    func testIsOnByDefaultAndFollowsItsKey() {
        let suite = "PaychecksSwitchTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        XCTAssertTrue(NativeScreenSwitch.isPaychecksNative(defaults: defaults))
        XCTAssertEqual(NativeScreenSwitch.paychecksKey, "NativeScreen.paychecks")
        defaults.set(false, forKey: NativeScreenSwitch.paychecksKey)
        XCTAssertFalse(NativeScreenSwitch.isPaychecksNative(defaults: defaults))
        defaults.set(true, forKey: NativeScreenSwitch.paychecksKey)
        XCTAssertTrue(NativeScreenSwitch.isPaychecksNative(defaults: defaults))
    }

    func testThePageScriptCarriesTheSwitch() {
        let suite = "PaychecksSwitchTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set(true, forKey: NativeScreenSwitch.paychecksKey)
        let source = NativeScreensScript.source(defaults: defaults, expectedOrigin: "capacitor://localhost")
        XCTAssertTrue(source.contains(#""paychecks": true"#), source)
    }
}
