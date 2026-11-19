import Foundation
import XCTest

@testable import NativeBridgeCore

// sc-3611 (native-accounts-screen D7, task 3.1 and 3.2): what the native Accounts
// list shows that is not a number loot-core sent: each row's detail line, the
// subtitle's sync status, a move's target in Edit mode, and Reopen and Move with
// their Undo. Every balance and total stays loot-core's.
private let fixturesDir = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("loot-core/src/server/native/fixtures")

private func listFixture() throws -> String {
    String(decoding: try Data(contentsOf: fixturesDir.appendingPathComponent("accounts-list.json")), as: UTF8.self)
}

private func decodedList() throws -> AccountsList {
    try JSONDecoder().decode(AccountsList.self, from: Data(try listFixture().utf8))
}

private func account(_ id: String, in list: AccountsList) -> AccountsList.Account {
    (list.sections.onBudget.accounts + list.sections.offBudget.accounts + list.closed.accounts).first { $0.id == id }!
}

final class AccountDetailTests: XCTestCase {
    func testAClearingAccountNamesItsPaycheckFirst() throws {
        XCTAssertEqual(AccountDetail(account("card", in: try decodedList())), .clearing(paycheck: "Acme"))
    }

    func testALinkedAccountSaysWhenItLastSynced() throws {
        // lastSync is ms since 1970, as the account stores it
        XCTAssertEqual(AccountDetail(account("checking", in: try decodedList())), .synced(Date(timeIntervalSince1970: 1_483_228_800)))
    }

    func testOtherwiseTheLastTransactionDate() throws {
        XCTAssertEqual(AccountDetail(account("savings", in: try decodedList())), .updated("2016-12-20"))
    }

    func testAClosedAccountSaysItIsClosedAndWhichSection() throws {
        XCTAssertEqual(AccountDetail(account("old", in: try decodedList())), .closed(offBudget: false))
    }
}

final class NativeSyncStatusTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_000)

    private func event(_ payload: [String: Any]) -> [String: Any] { ["event": "sync-event", "payload": payload] }

    func testUnknownUntilTheFirstSyncEvent() {
        XCTAssertEqual(NativeSyncStatus.unknown.next(after: ["event": "cells-changed", "payload": [:]], now: now), .unknown)
    }

    func testStartSuccessAndFailures() {
        XCTAssertEqual(NativeSyncStatus.unknown.next(after: event(["type": "start"]), now: now), .syncing)
        XCTAssertEqual(NativeSyncStatus.syncing.next(after: event(["type": "success", "tables": []]), now: now), .synced(now))
        XCTAssertEqual(NativeSyncStatus.syncing.next(after: event(["type": "error", "subtype": "network"]), now: now), .offline)
        XCTAssertEqual(NativeSyncStatus.syncing.next(after: event(["type": "error"]), now: now), .failed)
        XCTAssertEqual(NativeSyncStatus.syncing.next(after: event(["type": "unauthorized"]), now: now), .failed)
        XCTAssertEqual(NativeSyncStatus.syncing.next(after: event(["type": "success", "tables": [], "syncDisabled": true]), now: now), .local)
    }

    // mobile-sync-status: a failure stays until a later sync outcome replaces it
    func testAFailureStaysThroughAppliedChangesUntilASyncCompletes() {
        XCTAssertEqual(NativeSyncStatus.failed.next(after: event(["type": "applied", "tables": ["transactions"]]), now: now), .failed)
        XCTAssertEqual(NativeSyncStatus.failed.next(after: event(["type": "start"]), now: now), .syncing)
        XCTAssertEqual(NativeSyncStatus.failed.next(after: event(["type": "success", "tables": []]), now: now), .synced(now))
    }

    // native-durable-writes: "A held sync never reports success" (sc-5219)
    func testAHeldSyncSaysItIsWaitingThroughItsRetries() {
        let held = NativeSyncStatus.syncing.next(after: event(["type": "error", "subtype": "storage-slow"]), now: now)
        XCTAssertEqual(held, .waitingForStorage)
        XCTAssertEqual(held.next(after: event(["type": "start"]), now: now), .waitingForStorage)
        XCTAssertEqual(held.next(after: event(["type": "error", "subtype": "storage-slow"]), now: now), .waitingForStorage)
        XCTAssertEqual(held.next(after: event(["type": "success", "tables": []]), now: now), .synced(now))
        XCTAssertEqual(held.next(after: event(["type": "error", "subtype": "storage-failed"]), now: now), .failed)
        XCTAssertEqual(NativeSyncStatus.synced(now).after(pull: .waitingForStorage, now: now), .waitingForStorage)
        XCTAssertEqual(NativeSyncStatus.waitingMessage, "Waiting for this device to finish saving")
    }

    // Product Owner, PR #485: one fixed text, so writes never change it or move the list
    func testOfflineIsAlwaysJustOffline() {
        XCTAssertEqual(NativeSyncStatus.offlineMessage, "Offline")
    }

    func testAPullsOutcome() {
        XCTAssertEqual(NativeSyncStatus.unknown.after(pull: nil, now: now), .synced(now))
        XCTAssertEqual(NativeSyncStatus.unknown.after(pull: .offline, now: now), .offline)
        XCTAssertEqual(NativeSyncStatus.unknown.after(pull: .signedOut, now: now), .failed)
        XCTAssertEqual(NativeSyncStatus.unknown.after(pull: .failed, now: now), .failed)
        // Still running: the sync's own events say how it ends
        XCTAssertEqual(NativeSyncStatus.synced(now).after(pull: .timedOut, now: now), .syncing)
    }
}

final class AccountMoveTargetTests: XCTestCase {
    private let ids = ["a", "b", "c", "d"]

    // SwiftUI's onMove: `to` is an index in the list before the row is taken out
    func testMovingUpGoesBeforeTheRowAtTheDropIndex() {
        XCTAssertEqual(AccountMove.target(in: ids, from: 2, to: 0), .before("a"))
    }

    func testMovingDownGoesBeforeTheRowAtTheDropIndex() {
        XCTAssertEqual(AccountMove.target(in: ids, from: 0, to: 2), .before("c"))
    }

    func testDroppingAfterTheLastRowMovesToTheEnd() {
        XCTAssertEqual(AccountMove.target(in: ids, from: 0, to: 4), .end)
    }

    func testDroppingInPlaceIsNoMove() {
        XCTAssertNil(AccountMove.target(in: ids, from: 1, to: 1))
        XCTAssertNil(AccountMove.target(in: ids, from: 1, to: 2))
        XCTAssertNil(AccountMove.target(in: ids, from: 7, to: 0))
    }

    // Shown at once while the write and the re-read run; the re-read replaces it
    func testTheListShowsTheMoveWithinTheSectionOnly() throws {
        let list = try decodedList()
        let moved = list.moving("card", before: "checking")
        XCTAssertEqual(moved.sections.onBudget.accounts.map(\.id), ["card", "checking", "savings"])
        XCTAssertEqual(moved.sections.onBudget.total, list.sections.onBudget.total)
        XCTAssertEqual(list.moving("checking", before: nil).sections.onBudget.accounts.map(\.id), ["savings", "card", "checking"])
        // Not across sections
        XCTAssertEqual(list.moving("house", before: "checking"), list)
    }
}

private struct Boom: Error {}

@MainActor
private final class FakeListPage {
    var calls: [(name: String, args: String)] = []
    var failures: [String: Error] = [:]
    var syncReply = "null"
    let list: String

    init() throws { list = try listFixture() }

    var client: NativeBridgeClient {
        NativeBridgeClient(timeout: 1) { name, args in
            try await MainActor.run {
                self.calls.append((name, args))
                if let failure = self.failures[name] { throw failure }
                if name == "sync" { return self.syncReply }
                return name == "native/accounts-list" ? self.list : "null"
            }
        }
    }

    func args(_ name: String) throws -> [String: Any] {
        let call = try XCTUnwrap(calls.last { $0.name == name })
        return try JSONSerialization.jsonObject(with: Data(call.args.utf8)) as! [String: Any]
    }
}

// The Undo offer's lifetime waits here until the test ends it
private final class UndoClock {
    private var waiting: [CheckedContinuation<Void, Never>] = []
    var sleep: AccountsSleep { { [self] _ in await withCheckedContinuation { waiting.append($0) } } }
    var pending: Int { waiting.count }

    func expireFirst() { waiting.removeFirst().resume() }

    func expire() {
        let all = waiting
        waiting = []
        all.forEach { $0.resume() }
    }
}

@MainActor
final class AccountsListWriteTests: XCTestCase {
    private let clock = UndoClock()

    private func model(_ page: FakeListPage) -> AccountsListViewModel {
        AccountsListViewModel(client: page.client, schedule: { _, _ in }, undoSleep: clock.sleep)
    }

    func testReopenSendsTheWriteReReadsAndOffersUndo() async throws {
        let page = try FakeListPage()
        let model = model(page)
        await model.load()
        await model.reopen("old")
        XCTAssertEqual(page.calls.map(\.name), ["native/accounts-list", "native/account-reopen", "native/accounts-list"])
        let token = try XCTUnwrap(page.args("native/account-reopen")["undoToken"] as? String)
        XCTAssertEqual(try page.args("native/account-reopen")["id"] as? String, "old")
        XCTAssertEqual(model.undoOffer, AccountsUndoOffer(token: token, action: .reopen, name: "Old"))
        XCTAssertNil(model.actionError)
    }

    func testUndoSendsTheOffersTokenAndReReads() async throws {
        let page = try FakeListPage()
        let model = model(page)
        await model.load()
        await model.reopen("old")
        let token = model.undoOffer?.token
        await model.undo()
        XCTAssertEqual(try page.args("native/undo")["token"] as? String, token)
        XCTAssertEqual(page.calls.last?.name, "native/accounts-list")
        XCTAssertNil(model.undoOffer)
    }

    // D3a: loot-core refuses an Undo when a touched account changed since
    func testARefusedUndoSaysItChangedSince() async throws {
        let page = try FakeListPage()
        let model = model(page)
        await model.load()
        await model.reopen("old")
        page.failures["native/undo"] = NativeBridgeError.page("[native:undo-changed-since] words that may change")
        await model.undo()
        XCTAssertEqual(model.actionError, .changedSince)
        XCTAssertEqual(model.actionError?.message, "Changed since — can't undo.")
        XCTAssertNil(model.undoOffer)
    }

    // PR 424 review: only a conflict says "Changed since"
    func testOtherUndoRefusalsSayWhatHappened() async throws {
        let page = try FakeListPage()
        let model = model(page)
        await model.load()
        await model.reopen("old")
        page.failures["native/undo"] = NativeBridgeError.page("[native:undo-nothing] words that may change")
        await model.undo()
        XCTAssertEqual(model.actionError, .nothingToUndo)
        XCTAssertEqual(model.actionError?.message, "There is nothing to undo.")
        await model.reopen("old")
        page.failures["native/undo"] = Boom()
        await model.undo()
        XCTAssertEqual(model.actionError, .undoFailed)
        XCTAssertEqual(model.actionError?.message, "Couldn't undo. Nothing was undone.")
    }

    func testAFailedWriteChangesNothingAndSaysSo() async throws {
        let page = try FakeListPage()
        let model = model(page)
        await model.load()
        page.failures["native/account-reopen"] = Boom()
        await model.reopen("old")
        XCTAssertEqual(model.actionError, .reopenFailed)
        XCTAssertNil(model.undoOffer)
        page.failures["native/account-reopen"] = NativeBridgeError.timedOut("native/account-reopen")
        await model.reopen("old")
        XCTAssertEqual(model.actionError, .timedOut)
    }

    func testTheOfferExpires() async throws {
        let page = try FakeListPage()
        let model = model(page)
        await model.load()
        await model.reopen("old")
        try await waitUntil("the offer's timer started") { clock.pending == 1 }
        clock.expire()
        try await waitUntil("the offer expired") { model.undoOffer == nil }
    }

    // An older offer's timer does not withdraw a newer one
    func testANewerOfferOutlivesTheOldTimer() async throws {
        let page = try FakeListPage()
        let model = model(page)
        await model.load()
        await model.reopen("old")
        try await waitUntil("the first timer started") { clock.pending == 1 }
        await model.move(in: .onBudget, from: 2, to: 0)
        try await waitUntil("the second timer started") { clock.pending == 2 }
        clock.expireFirst()
        await Task.yield()
        XCTAssertEqual(model.undoOffer?.action, .move)
        clock.expire()
        try await waitUntil("the newer offer expired") { model.undoOffer == nil }
    }

    func testMoveSendsTheTargetShowsTheOrderAtOnceAndOffersUndo() async throws {
        let page = try FakeListPage()
        let model = model(page)
        await model.load()
        await model.move(in: .onBudget, from: 2, to: 0)
        let args = try page.args("native/account-move")
        XCTAssertEqual(args["id"] as? String, "card")
        XCTAssertEqual(args["targetId"] as? String, "checking")
        XCTAssertEqual(model.undoOffer?.action, .move)
        XCTAssertEqual(model.undoOffer?.name, "Card")
        XCTAssertEqual(page.calls.last?.name, "native/accounts-list")
    }

    func testMoveToTheEndSendsNull() async throws {
        let page = try FakeListPage()
        let model = model(page)
        await model.load()
        await model.move(in: .onBudget, from: 0, to: 3)
        XCTAssertTrue(try page.args("native/account-move")["targetId"] is NSNull)
    }

    func testAFailedMovePutsTheOrderBack() async throws {
        let page = try FakeListPage()
        let model = model(page)
        await model.load()
        page.failures["native/account-move"] = Boom()
        await model.move(in: .onBudget, from: 2, to: 0)
        XCTAssertEqual(model.state.value?.sections.onBudget.accounts.map(\.id), ["checking", "savings", "card"])
        XCTAssertEqual(model.actionError, .moveFailed)
    }

    func testDroppingInPlaceSendsNothing() async throws {
        let page = try FakeListPage()
        let model = model(page)
        await model.load()
        await model.move(in: .offBudget, from: 0, to: 1)
        XCTAssertEqual(page.calls.map(\.name), ["native/accounts-list"])
    }

    func testThePullAndSyncEventsSetTheSyncStatus() async throws {
        let page = try FakeListPage()
        page.failures["sync"] = Boom()
        let model = model(page)
        await model.load()
        XCTAssertEqual(model.syncStatus, .unknown)
        model.syncStatus = .synced(Date(timeIntervalSince1970: 0))
        await model.refresh()
        XCTAssertEqual(model.syncStatus, .failed)
    }

    func testAHeldPullIsNotAFailure() async throws {
        let page = try FakeListPage()
        page.syncReply = #"{"ok":false,"reason":"storage-slow"}"#
        let model = model(page)
        await model.load()
        let shown = model.state
        await model.refresh()
        XCTAssertEqual(model.syncStatus, .waitingForStorage)
        XCTAssertNil(model.refreshError)
        XCTAssertEqual(model.state, shown)
    }
}

// PR 424 review: counts agree with their noun
final class AccountsCountWordsTests: XCTestCase {
    func testOneAccountAndSeveral() {
        XCTAssertEqual(AccountsCountWords.accounts(1), "1 account")
        XCTAssertEqual(AccountsCountWords.accounts(2), "2 accounts")
        XCTAssertEqual(AccountsCountWords.toReconcile(1), "1 account to reconcile")
        XCTAssertEqual(AccountsCountWords.toReconcile(3), "3 accounts to reconcile")
        XCTAssertEqual(AccountsCountWords.results(1), "1 result")
        XCTAssertEqual(AccountsCountWords.results(0), "0 results")
    }
}

// Task 3.6: what the screens announce to VoiceOver when a read fails. A new failure
// changes this value once; a repeat of the same failure does not.
final class AccountsLoadErrorTests: XCTestCase {
    func testOnlyAFailedReadCarriesAnError() throws {
        let list = try decodedList()
        XCTAssertNil(AccountsLoad<AccountsList>.loading.error)
        XCTAssertNil(AccountsLoad.loaded(list).error)
        XCTAssertEqual(AccountsLoad<AccountsList>.failed(.timedOut).error, .timedOut)
        XCTAssertEqual(AccountsLoad.stale(list, .other).error, .other)
    }
}
