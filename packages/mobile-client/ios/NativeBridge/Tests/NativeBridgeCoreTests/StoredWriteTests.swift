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
        status.pageLoaded(epoch: "e")
        // The barrier as the guard-on shell sees it
        return NativeBridgeClient(timeout: timeout, storage: status, storageGuardOn: true) { name, _ in
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
        status.pageLoaded(epoch: "e")
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
        status.pageLoaded(epoch: "new")
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
        status.pageLoaded(epoch: "new")
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
        status.pageLoaded(epoch: "new")
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "new", n: 1)), ticket: status.nextTicket())
        XCTAssertEqual(status.message, WriteStorageStatus.notYetStoredMessage)
    }

    func testAnOlderTicketFromBeforeARestartStaysOlderAfterIt() {
        let status = WriteStorageStatus()
        let before = status.nextTicket()
        status.pageLoaded(epoch: "new")
        let after = status.nextTicket()
        XCTAssertGreaterThan(after, before)
    }

    // The new page can answer before its "ready" message is handled
    func testReadyAfterANewEpochDoesNotRetireTheNewPage() {
        let status = WriteStorageStatus()
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "old", n: 1)))
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "new", n: 1)))
        status.pageLoaded(epoch: "new")
        XCTAssertEqual(status.message, WriteStorageStatus.notYetStoredMessage)
        status.record(PersistedAnswer(stored: true, seq: PersistedSeq(epoch: "new", n: 2)))
        XCTAssertNil(status.message)
        XCTAssertTrue(status.mayNotBeSaved)
    }

    // Security's probes on PR #485
    func testAWriteAnsweredByTheNextPageIsNotStored() async throws {
        let status = WriteStorageStatus()
        status.pageLoaded(epoch: "old")
        let bridge = NativeBridgeClient(storage: status, storageGuardOn: true) { name, _ in
            name == "native/persisted" ? #"{"stored":true,"seq":{"epoch":"new","n":1}}"# : "null"
        }
        let result = try await bridge.write("native/account-move", args: move)
        XCTAssertFalse(result.stored)
        XCTAssertTrue(status.mayNotBeSaved)
    }

    func testAFirstWriteAnsweredBeforeReadyIsNotStored() async throws {
        let status = WriteStorageStatus()
        let bridge = NativeBridgeClient(storage: status, storageGuardOn: true) { name, _ in
            name == "native/persisted" ? #"{"stored":true,"seq":{"epoch":"new","n":1}}"# : "null"
        }
        let result = try await bridge.write("native/account-move", args: move)
        XCTAssertFalse(result.stored)
        XCTAssertTrue(status.mayNotBeSaved)
    }

    // sc-5303 (design D7a): with the shell's switch off, the opened API behaves as today
    func testWithTheGuardOffAWriteCountsAsStoredAtOnce() async throws {
        let status = WriteStorageStatus()
        status.pageLoaded(epoch: "e")
        let bridge = NativeBridgeClient(storage: status) { name, _ in
            name == "native/persisted" ? #"{"stored":false,"seq":{"epoch":"e","n":1}}"# : "null"
        }
        let result = try await bridge.write("native/account-move", args: move)
        XCTAssertTrue(result.stored)
        let later = await bridge.whenStored(result)
        XCTAssertTrue(later)
    }

    func testWithTheGuardOnAWriteWaitsForItsStoredEvent() async throws {
        let status = WriteStorageStatus()
        status.pageLoaded(epoch: "e")
        let bridge = NativeBridgeClient(storage: status, storageGuardOn: true) { name, _ in
            name == "native/persisted" ? #"{"stored":false,"seq":{"epoch":"e","n":1}}"# : "null"
        }
        let result = try await bridge.write("native/account-move", args: move)
        XCTAssertFalse(result.stored)
        let waiting = Task { await bridge.whenStored(result) }
        try await Task.sleep(nanoseconds: 20_000_000)
        status.storedEvent(seq: 1, epoch: "e")
        let stored = await waiting.value
        XCTAssertTrue(stored)
    }

    func testWithTheGuardOnARestartMeansNeverStored() async throws {
        let status = WriteStorageStatus()
        status.pageLoaded(epoch: "e")
        let bridge = NativeBridgeClient(storage: status, storageGuardOn: true) { name, _ in
            name == "native/persisted" ? #"{"stored":false,"seq":{"epoch":"e","n":1}}"# : "null"
        }
        let result = try await bridge.write("native/account-move", args: move)
        let waiting = Task { await bridge.whenStored(result) }
        try await Task.sleep(nanoseconds: 20_000_000)
        status.pageLoaded(epoch: "f")
        let stored = await waiting.value
        XCTAssertFalse(stored)
    }

    // sc-5302: a retired page's own "not stored" stays its own
    func testARetiredPagesNotStoredAnswerIsALossAndLeavesTheNewPageAlone() {
        let status = WriteStorageStatus()
        status.pageLoaded(epoch: "a")
        let origin = status.writeBegan()
        status.writeEnded()
        status.pageLoaded(epoch: "b")
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "b", n: 1)))
        XCTAssertFalse(status.mayNotBeSaved)
        let stored = status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "a", n: 7)), madeIn: origin)
        XCTAssertFalse(stored)
        XCTAssertTrue(status.mayNotBeSaved)
        XCTAssertEqual(status.message, WriteStorageStatus.notYetStoredMessage, "b's write is still waiting")
        status.storedEvent(seq: 1, epoch: "b")
        XCTAssertNil(status.message)
        XCTAssertTrue(status.mayNotBeSaved, "b's success does not vouch for a's write")
    }

    func testALateReadyFromTheSamePageKeepsItsNextUnstoredWrite() {
        let status = WriteStorageStatus()
        status.record(PersistedAnswer(stored: true, seq: PersistedSeq(epoch: "live", n: 1)))
        status.pageLoaded(epoch: "live")
        status.record(
            PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "live", n: 2)), madeIn: status.writeBegan())
        status.writeEnded()
        XCTAssertEqual(status.message, WriteStorageStatus.notYetStoredMessage)
        XCTAssertFalse(status.mayNotBeSaved)
    }

    func testTheOldPagesOwnLateAnswerStillCounts() {
        let status = WriteStorageStatus()
        status.pageLoaded(epoch: "old")
        let origin = status.writeBegan()
        status.writeEnded()
        status.pageLoaded(epoch: "new")
        XCTAssertTrue(status.record(PersistedAnswer(stored: true, seq: PersistedSeq(epoch: "old", n: 1)), madeIn: origin))
        XCTAssertFalse(status.mayNotBeSaved)
    }

    // A possible loss is for the restart notice: the line shows only saving in progress
    func testAPossibleLossIsNotShownAsSaving() {
        let status = WriteStorageStatus()
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "old", n: 1)))
        status.pageLoaded(epoch: "new")
        XCTAssertNil(status.message)
        XCTAssertTrue(status.mayNotBeSaved)
    }

    func testAStalePagesStoredEventIsIgnored() {
        let status = WriteStorageStatus()
        status.pageLoaded(epoch: "old")
        status.pageLoaded(epoch: "new")
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "new", n: 1)))
        status.storedEvent(seq: 5, epoch: "old")
        XCTAssertEqual(status.message, WriteStorageStatus.notYetStoredMessage)
        // Nor does it count against this page's later writes
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "new", n: 2)))
        status.storedEvent(seq: 1, epoch: "new")
        XCTAssertEqual(status.message, WriteStorageStatus.notYetStoredMessage)
        status.storedEvent(seq: 2, epoch: "new")
        XCTAssertNil(status.message)
    }

    func testReadyCarriesOnlyThePageLoad() {
        XCTAssertEqual(NativeBridgeEvent.readyEpoch(of: ["event": "ready", "payload": ["epoch": "e"]]), "e")
        XCTAssertNil(NativeBridgeEvent.readyEpoch(of: ["event": "ready", "payload": NSNull()]))
        XCTAssertNil(NativeBridgeEvent.readyEpoch(of: ["event": "stored", "payload": ["epoch": "e"]]))
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
        status.pageLoaded(epoch: "new")
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "new", n: 1)))
        status.record(PersistedAnswer(stored: true, seq: PersistedSeq(epoch: "old", n: 99)))
        status.acknowledgeMayNotBeSaved()
        XCTAssertEqual(status.message, WriteStorageStatus.notYetStoredMessage)
    }

    func testAStoredAnswerWithoutPendingWritesAfterALoadChangesNothing() {
        let status = WriteStorageStatus()
        status.pageLoaded(epoch: "new")
        status.record(PersistedAnswer(stored: true, seq: PersistedSeq(epoch: "new", n: 99)))
        XCTAssertNil(status.message)
    }

    func testThePersonIsToldToKeepTheAppOpen() {
        XCTAssertEqual(WriteStorageStatus.notYetStoredMessage, "Still saving to this device. Keep the app open.")
    }

    func testTheLineFollowsAWriteUntilItIsStored() {
        let status = WriteStorageStatus()
        XCTAssertNil(status.message)
        status.writeBegan()
        XCTAssertEqual(status.message, WriteStorageStatus.savingMessage)
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "e", n: 1)))
        status.writeEnded()
        XCTAssertEqual(status.message, WriteStorageStatus.notYetStoredMessage)
        status.storedEvent(seq: 1, epoch: "e")
        XCTAssertNil(status.message)
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

    // D8: a lifecycle flush asks for every file, and only the storage status hears the answer
    func testAFlushAsksForEveryFileAndTellsOnlyTheStorageStatus() async {
        var sent: [(String, String)] = []
        let status = WriteStorageStatus()
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "e", n: 1)))
        let bridge = NativeBridgeClient(storage: status) { name, args in
            sent.append((name, args))
            return #"{"stored":true,"seq":{"epoch":"e","n":2}}"#
        }
        await bridge.flushStorage()
        XCTAssertEqual(sent.map(\.0), ["native/persisted"])
        XCTAssertEqual(sent.first?.1, #"{"allFiles":true}"#)
        XCTAssertNil(status.message)
    }

    func testAFlushThatFailsChangesNothing() async {
        let status = WriteStorageStatus()
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "e", n: 1)))
        let bridge = NativeBridgeClient(storage: status) { _, _ in throw NativeBridgeError.noPage }
        await bridge.flushStorage()
        XCTAssertEqual(status.message, WriteStorageStatus.notYetStoredMessage)
    }

    func testABackgroundFlushEndsItsTaskOnceWhenTheAnswerComes() async {
        let answer = AsyncGate()
        var ended: [Int] = []
        var begun = 0
        let flush = BackgroundFlush<Int>(
            begin: { _ in
                begun += 1
                return 7
            }, end: { ended.append($0) }, flush: { await answer.wait() })
        flush.run()
        flush.run()
        XCTAssertEqual(begun, 1)
        XCTAssertEqual(ended, [])
        await answer.open()
        await waitUntil { ended == [7] }
        try? await Task.sleep(nanoseconds: 10_000_000)
        XCTAssertEqual(ended, [7])
    }

    func testABackgroundFlushEndsItsTaskAtOnceOnExpiry() async {
        let answer = AsyncGate()
        var expire: () -> Void = {}
        var ended: [Int] = []
        let flush = BackgroundFlush<Int>(
            begin: { onExpiry in
                expire = onExpiry
                return 7
            }, end: { ended.append($0) }, flush: { await answer.wait() })
        flush.run()
        expire()
        XCTAssertEqual(ended, [7])
        await answer.open()
        try? await Task.sleep(nanoseconds: 10_000_000)
        XCTAssertEqual(ended, [7])
    }

    // sc-5308: a flush waits for every file, writes for the open budget only, so a
    // flush's "not stored" can't join their order: a narrower "stored" would clear it
    func testAFlushThatIsNotStoredIsNotRecorded() async {
        let status = WriteStorageStatus()
        var reply = #"{"stored":false,"seq":{"epoch":"e","n":1}}"#
        let bridge = NativeBridgeClient(storage: status) { _, _ in reply }
        await bridge.flushStorage()
        XCTAssertNil(status.message)
        status.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "e", n: 2)))
        XCTAssertEqual(status.message, WriteStorageStatus.notYetStoredMessage)
        reply = #"{"stored":true,"seq":{"epoch":"e","n":3}}"#
        await bridge.flushStorage()
        XCTAssertNil(status.message)
    }

    // sc-5309: an answer or expiry ends only its own background task
    func testALateFirstFlushDoesNotEndANewerTask() async {
        let gates = [AsyncGate(), AsyncGate()]
        var expire: () -> Void = {}
        var begun = 0
        var calls = 0
        var ended: [Int] = []
        let flush = BackgroundFlush<Int>(
            begin: { onExpiry in
                expire = onExpiry
                begun += 1
                return begun
            }, end: { ended.append($0) },
            flush: {
                calls += 1
                await gates[calls - 1].wait()
            })
        flush.run()
        expire()
        XCTAssertEqual(ended, [1])
        flush.run()
        XCTAssertEqual(begun, 2)
        await gates[0].open()
        try? await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertEqual(ended, [1])
        await gates[1].open()
        await waitUntil { ended == [1, 2] }
        XCTAssertEqual(ended, [1, 2])
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

    // Designer, PR #485: the line never sits on the field being typed in
    func testTheLineMovesOnlyWhenItWouldCoverTheField() {
        func covers(_ fieldTop: CGFloat, _ fieldHeight: CGFloat = 40) -> Bool {
            WriteStorageLinePlacement.coversField(
                CGRect(x: 0, y: fieldTop, width: 300, height: fieldHeight), lineHeight: 30, keyboardTop: 500)
        }
        XCTAssertTrue(covers(450))
        XCTAssertTrue(covers(435))
        XCTAssertFalse(covers(100))
        XCTAssertFalse(covers(422, 40))
        XCTAssertFalse(
            WriteStorageLinePlacement.coversField(nil, lineHeight: 30, keyboardTop: 500))
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
