import Combine
import Foundation
import XCTest

@testable import NativeBridgeCore

// native-bridge: "A write is saved only when storage says so" and "The storage
// barrier waits for complete" (sc-5219, native-durable-writes D3, D4)
private let move = try! AccountMove(id: "a", targetId: nil, undoToken: "t")

private actor Calls {
    private(set) var names: [String] = []
    func add(_ name: String) { names.append(name) }
    func count(_ name: String) -> Int { names.filter { $0 == name }.count }
}

@MainActor
final class StoredWriteTests: XCTestCase {
    private func client(
        status: WriteStorageStatus, calls: Calls = Calls(), timeout: TimeInterval = 5,
        persisted: @escaping (Int) async throws -> String = { _ in #"{"stored":true}"# }
    ) -> NativeBridgeClient {
        NativeBridgeClient(timeout: timeout, storage: status) { name, _ in
            await calls.add(name)
            guard name == "native/persisted" else { return "null" }
            return try await persisted(await calls.count(name))
        }
    }

    // Named here, so a list that loses one cannot quietly skip the barrier
    func testEveryWriteIsAWrite() {
        let writes = [
            "budget/budget-amount", "budget/transfer-category", "budget/transfer-available", "paycheck-skip-next", "native/undo",
            "native/paycheck-save", "paycheck-delete", "native/reconcile-tick", "native/reconcile-list-set",
            "account-statement-balance-save", "native/reconcile-adjust", "native/reconcile-lock", "native/transactions-categorize",
            "native/transactions-delete", "native/account-reopen", "native/account-move", "native/transaction-save",
            "native/settings-save",
        ]
        XCTAssertEqual(writes.count, 18)
        for name in writes { XCTAssertEqual(NativeBridgeAllowlist.kind(of: name), .write, name) }
    }

    // As on the page: only what is listed as a read skips the barrier
    func testOnlyListedNamesAreReads() {
        let others = NativeBridgeAllowlist.handlers.filter { NativeBridgeAllowlist.kind(of: $0) != .write }
        XCTAssertEqual(
            others,
            NativeBridgeAllowlist.allReads.union(NativeBridgeAllowlist.sync).union(NativeBridgeAllowlist.storage))
    }

    func testAnOlderStoredAnswerDoesNotClearANewerWrite() {
        let status = WriteStorageStatus()
        let older = status.nextTicket()
        let newer = status.nextTicket()
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "e", n: 2)), ticket: newer)
        status.record(PersistedAnswer(stored: true), ticket: older)
        XCTAssertEqual(status.message, WriteStorageStatus.notYetStoredMessage)
        status.record(PersistedAnswer(stored: true), ticket: status.nextTicket())
        XCTAssertNil(status.message)
    }

    func testAnOlderNotStoredAnswerDoesNotUndoANewerStoredOne() {
        let status = WriteStorageStatus()
        let older = status.nextTicket()
        let newer = status.nextTicket()
        status.record(PersistedAnswer(stored: true), ticket: newer)
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "e", n: 1)), ticket: older)
        XCTAssertNil(status.message)
    }

    func testAStoredEventThatArrivesBeforeItsAnswerCounts() {
        let status = WriteStorageStatus()
        status.storedEvent(seq: 5, epoch: "e")
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "e", n: 5)), ticket: status.nextTicket())
        XCTAssertNil(status.message)
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "e", n: 6)), ticket: status.nextTicket())
        XCTAssertEqual(status.message, WriteStorageStatus.notYetStoredMessage)
    }

    // A later number's writes include every earlier one's
    func testAStoredEventCoversEarlierNumbers() {
        let status = WriteStorageStatus()
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "e", n: 1)), ticket: status.nextTicket())
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "e", n: 2)), ticket: status.nextTicket())
        status.storedEvent(seq: 2, epoch: "e")
        XCTAssertNil(status.message)
    }

    // The call timed out, its retry answered not stored, and that retry's writes landed
    func testARetrysStoredEventClearsTheTimedOutWrite() {
        let status = WriteStorageStatus()
        status.record(.notStored, ticket: status.nextTicket())
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "e", n: 3)), ticket: status.nextTicket())
        XCTAssertEqual(status.message, WriteStorageStatus.notYetStoredMessage)
        status.storedEvent(seq: 3, epoch: "e")
        XCTAssertNil(status.message)
    }

    func testARetrysStoredEventCountsEvenBeforeItsAnswer() {
        let status = WriteStorageStatus()
        status.record(.notStored, ticket: status.nextTicket())
        status.storedEvent(seq: 3, epoch: "e")
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "e", n: 3)), ticket: status.nextTicket())
        XCTAssertNil(status.message)
    }

    func testAWriteAfterTheRetryIsNotCovered() {
        let status = WriteStorageStatus()
        let retry = status.nextTicket()
        let later = status.nextTicket()
        status.record(.notStored, ticket: later)
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "e", n: 3)), ticket: retry)
        status.storedEvent(seq: 3, epoch: "e")
        XCTAssertEqual(status.message, WriteStorageStatus.notYetStoredMessage)
    }

    // Only the client asks, so no caller can read an answer the guard doesn't back yet
    func testTheStorageCallsCannotBeMadeDirectly() async {
        let bridge = NativeBridgeClient { _, _ in #"{"stored":true}"# }
        for name in NativeBridgeAllowlist.storage {
            do {
                _ = try await bridge.call(name)
                XCTFail(name)
            } catch {
                XCTAssertEqual(error as? NativeBridgeError, .notAllowlisted(name))
            }
        }
    }

    func testEveryAllowlistedNameHasAKind() {
        for name in NativeBridgeAllowlist.handlers {
            XCTAssertNotNil(NativeBridgeAllowlist.kind(of: name), name)
        }
        XCTAssertEqual(NativeBridgeAllowlist.kind(of: "native/account-move"), .write)
        XCTAssertEqual(NativeBridgeAllowlist.kind(of: "native/undo"), .write)
        XCTAssertEqual(NativeBridgeAllowlist.kind(of: "native/accounts-list"), .read)
        XCTAssertEqual(NativeBridgeAllowlist.kind(of: "sync"), .sync)
        XCTAssertEqual(NativeBridgeAllowlist.kind(of: "native/persisted"), .storage)
        XCTAssertNil(NativeBridgeAllowlist.kind(of: "undo"))
    }

    func testAWriteIsFollowedByItsOwnStorageCallAndReturnsStored() async throws {
        let calls = Calls()
        let result = try await client(status: WriteStorageStatus(), calls: calls)
            .write("native/account-move", args: move)
        XCTAssertTrue(result.stored)
        let names = await calls.names
        XCTAssertEqual(names, ["native/account-move", "native/persisted"])
    }

    func testEveryExistingWriteMethodGoesThroughTheBarrier() async throws {
        let calls = Calls()
        try await client(status: WriteStorageStatus(), calls: calls).moveAccount(move)
        let names = await calls.names
        XCTAssertEqual(names, ["native/account-move", "native/persisted"])
    }

    func testAReadDoesNotWait() async throws {
        let calls = Calls()
        _ = try await client(status: WriteStorageStatus(), calls: calls).call("native/accounts-list")
        let names = await calls.names
        XCTAssertEqual(names, ["native/accounts-list"])
    }

    func testSavingShowsUntilTheStorageCallAnswers() async throws {
        let status = WriteStorageStatus()
        let answer = AsyncGate()
        let write = Task { [self] in
            try await client(status: status) { _ in
                await answer.wait()
                return #"{"stored":true}"#
            }.moveAccount(move)
        }
        await waitUntil { status.message == WriteStorageStatus.savingMessage }
        await answer.open()
        try await write.value
        XCTAssertNil(status.message)
    }

    func testNotStoredShowsAndClearsOnItsStoredEvent() async throws {
        let status = WriteStorageStatus()
        let result = try await client(status: status) { _ in #"{"stored":false,"seq":{"epoch":"e","n":4}}"# }
            .write("native/account-move", args: move)
        XCTAssertFalse(result.stored)
        XCTAssertEqual(status.message, WriteStorageStatus.notYetStoredMessage)
        status.storedEvent(seq: 3, epoch: "e")
        XCTAssertEqual(status.message, WriteStorageStatus.notYetStoredMessage)
        status.storedEvent(seq: 4, epoch: "e")
        XCTAssertNil(status.message)
    }

    func testALaterStoredAnswerClearsAnEarlierNotStored() async throws {
        let status = WriteStorageStatus()
        let bridge = client(status: status) { count in
            count == 1 ? #"{"stored":false,"seq":{"epoch":"e","n":1}}"# : #"{"stored":true,"seq":{"epoch":"e","n":2}}"#
        }
        try await bridge.moveAccount(move)
        try await bridge.moveAccount(move)
        XCTAssertNil(status.message)
    }

    func testATimedOutStorageCallIsNotStoredAndOnlyThatCallIsRetried() async throws {
        let status = WriteStorageStatus()
        let calls = Calls()
        let retried = expectation(description: "native/persisted asked again")
        let result = try await client(status: status, calls: calls, timeout: 0.05) { count in
            if count == 1 {
                try await Task.sleep(nanoseconds: 5_000_000_000)
            }
            retried.fulfill()
            return #"{"stored":true}"#
        }.write("native/account-move", args: move)
        XCTAssertFalse(result.stored)
        await fulfillment(of: [retried], timeout: 2)
        await waitUntil { status.message == nil }
        let writes = await calls.count("native/account-move")
        XCTAssertEqual(writes, 1)
    }

    func testARefusedStorageCallIsNotStoredAndTheWriteStillReturns() async throws {
        let status = WriteStorageStatus()
        let result = try await client(status: status) { _ in
            throw NativeBridgeError.page("[native:not-stored] gone")
        }.write("native/account-move", args: move)
        XCTAssertFalse(result.stored)
        XCTAssertEqual(status.message, WriteStorageStatus.notYetStoredMessage)
    }

    func testAFailedWriteAsksNothingAndClearsSaving() async {
        let status = WriteStorageStatus()
        let calls = Calls()
        let bridge = NativeBridgeClient(storage: status) { name, _ in
            await calls.add(name)
            throw NativeBridgeError.page("refused")
        }
        do {
            try await bridge.moveAccount(move)
            XCTFail("the write should fail")
        } catch {}
        let names = await calls.names
        XCTAssertEqual(names, ["native/account-move"])
        XCTAssertNil(status.message)
    }

    // Architect's ruling, task 3.6: a restart may have lost what was not stored
    func testARestartTurnsPendingWritesIntoMaybeLostAndNoLaterSuccessClearsThem() {
        let status = WriteStorageStatus()
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "old", n: 1)))
        status.pageLoaded()
        XCTAssertTrue(status.mayNotBeSaved)
        XCTAssertNil(status.message)
        status.record(PersistedAnswer(stored: true, seq: PersistedSeq(epoch: "new", n: 99)))
        XCTAssertTrue(status.mayNotBeSaved)
        XCTAssertNil(status.message)
        status.storedEvent(seq: 1, epoch: "new")
        status.storedEvent(seq: 1, epoch: "old")
        XCTAssertTrue(status.mayNotBeSaved)
        XCTAssertNil(status.message)
        status.acknowledgeMayNotBeSaved()
        XCTAssertFalse(status.mayNotBeSaved)
    }

    // The spec's "No answer before the restart"
    func testAWriteWithNoAnswerBelongsToThePageLoadItWasMadeIn() {
        let status = WriteStorageStatus()
        let generation = status.writeBegan()
        status.pageLoaded()
        status.record(.notStored, madeIn: generation)
        status.writeEnded()
        status.record(PersistedAnswer(stored: true, seq: PersistedSeq(epoch: "new", n: 1)))
        XCTAssertTrue(status.mayNotBeSaved)
        XCTAssertNil(status.message)
    }

    // Security on PR #482: numbers start again with each page load
    func testAnEarlierPagesStoredNumberDoesNotHideANewWrite() {
        let status = WriteStorageStatus()
        status.storedEvent(seq: 9, epoch: "old")
        status.pageLoaded()
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "new", n: 1)), ticket: status.nextTicket())
        XCTAssertEqual(status.message, WriteStorageStatus.notYetStoredMessage)
    }

    func testAnOlderTicketFromBeforeARestartStaysOlderAfterIt() {
        let status = WriteStorageStatus()
        let before = status.nextTicket()
        status.pageLoaded()
        let after = status.nextTicket()
        XCTAssertGreaterThan(after, before)
    }

    // The new page can answer before its "ready" message is handled
    func testReadyAfterANewEpochDoesNotRetireTheNewPage() {
        let status = WriteStorageStatus()
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "old", n: 1)))
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "new", n: 1)))
        status.pageLoaded()
        status.record(PersistedAnswer(stored: true, seq: PersistedSeq(epoch: "new", n: 2)))
        XCTAssertNil(status.message)
        XCTAssertTrue(status.mayNotBeSaved)
    }

    func testANewEpochAloneRevealsARestart() {
        let status = WriteStorageStatus()
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "old", n: 9)))
        status.record(PersistedAnswer(stored: true, seq: PersistedSeq(epoch: "new", n: 99)))
        XCTAssertTrue(status.mayNotBeSaved)
        XCTAssertNil(status.message)
    }

    func testStoredClearsOnlyItsOwnEpochAndEachWriteIsTracked() {
        let status = WriteStorageStatus()
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "e", n: 1)))
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "e", n: 2)))
        status.storedEvent(seq: 1, epoch: "e")
        XCTAssertEqual(status.message, WriteStorageStatus.notYetStoredMessage)
        status.storedEvent(seq: 2, epoch: "e")
        XCTAssertNil(status.message)
    }

    func testALateAnswerFromTheOldPageVouchesForNothing() {
        let status = WriteStorageStatus()
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "old", n: 1)))
        status.pageLoaded()
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "new", n: 1)))
        status.record(PersistedAnswer(stored: true, seq: PersistedSeq(epoch: "old", n: 99)))
        status.acknowledgeMayNotBeSaved()
        XCTAssertEqual(status.message, WriteStorageStatus.notYetStoredMessage)
    }

    func testAStoredAnswerWithoutPendingWritesAfterALoadChangesNothing() {
        let status = WriteStorageStatus()
        status.pageLoaded()
        status.record(PersistedAnswer(stored: true, seq: PersistedSeq(epoch: "new", n: 99)))
        XCTAssertNil(status.message)
    }

    func testThePersonIsToldToKeepTheAppOpen() {
        XCTAssertEqual(WriteStorageStatus.notYetStoredMessage, "Still saving to this device. Keep the app open.")
    }

    func testAWriteIsPendingWhileSavingAndWhileNotYetStored() {
        let status = WriteStorageStatus()
        XCTAssertFalse(status.isPending)
        status.writeBegan()
        XCTAssertTrue(status.isPending)
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "e", n: 1)))
        status.writeEnded()
        XCTAssertTrue(status.isPending)
        status.storedEvent(seq: 1, epoch: "e")
        XCTAssertFalse(status.isPending)
    }

    // A normal write takes milliseconds, so its "Saving…" must not flash
    func testSavingAppearsOnlyAfterTheDelayAndOtherMessagesAtOnce() async throws {
        let status = WriteStorageStatus()
        var shown: [String?] = []
        let watching = status.shownMessage(savingDelay: 0.05, savingMinimum: 0).sink { shown.append($0) }
        defer { watching.cancel() }
        status.writeBegan()
        status.writeEnded()
        try await Task.sleep(nanoseconds: 120_000_000)
        XCTAssertFalse(shown.contains(WriteStorageStatus.savingMessage))

        status.writeBegan()
        await waitUntil { shown.last == WriteStorageStatus.savingMessage }
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "e", n: 1)))
        status.writeEnded()
        XCTAssertEqual(shown.last, WriteStorageStatus.notYetStoredMessage)
        status.storedEvent(seq: 1, epoch: "e")
        XCTAssertEqual(shown.last, .some(nil))
    }

    func testSavingStaysUpForItsMinimumOnceShown() async throws {
        let status = WriteStorageStatus()
        var shown: [String?] = []
        let watching = status.shownMessage(savingDelay: 0.01, savingMinimum: 0.25).sink { shown.append($0) }
        defer { watching.cancel() }
        status.writeBegan()
        await waitUntil { shown.last == WriteStorageStatus.savingMessage }
        status.writeEnded()
        try await Task.sleep(nanoseconds: 60_000_000)
        XCTAssertEqual(shown.last, WriteStorageStatus.savingMessage)
        await waitUntil { shown.last == .some(nil) }
    }

    func testVoiceOverHearsOnlyTheNotYetStoredMessageOnce() {
        let saving = WriteStorageStatus.savingMessage
        let unstored = WriteStorageStatus.notYetStoredMessage
        XCTAssertNil(WriteStorageStatus.announcement(from: nil, to: saving))
        XCTAssertEqual(WriteStorageStatus.announcement(from: saving, to: unstored), unstored)
        XCTAssertNil(WriteStorageStatus.announcement(from: unstored, to: unstored))
        XCTAssertNil(WriteStorageStatus.announcement(from: unstored, to: nil))
    }

    func testTheStoredEventCarriesOnlyItsNumber() {
        let stored = NativeBridgeEvent.stored(of: ["event": "stored", "payload": ["seq": ["epoch": "e", "n": 7], "extra": 1]])
        XCTAssertEqual(stored?.seq, 7)
        XCTAssertEqual(stored?.epoch, "e")
        XCTAssertNil(NativeBridgeEvent.stored(of: ["event": "sync-event", "payload": ["seq": ["epoch": "e", "n": 7]]]))
        XCTAssertNil(NativeBridgeEvent.stored(of: ["event": "stored", "payload": ["seq": ["epoch": "e", "n": "7"]]]))
        XCTAssertNil(NativeBridgeEvent.stored(of: ["event": "stored", "payload": ["seq": 7]]))
    }

    private func waitUntil(_ condition: () -> Bool) async {
        for _ in 0..<500 where !condition() {
            try? await Task.sleep(nanoseconds: 2_000_000)
        }
        XCTAssertTrue(condition())
    }
}

private actor AsyncGate {
    private var isOpen = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func wait() async {
        if isOpen { return }
        await withCheckedContinuation { waiters.append($0) }
    }

    func open() {
        isOpen = true
        waiters.forEach { $0.resume() }
        waiters = []
    }
}
