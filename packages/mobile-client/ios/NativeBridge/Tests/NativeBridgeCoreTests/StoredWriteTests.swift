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
        let watching = status.shownMessage(savingDelay: 0.05).sink { shown.append($0) }
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

    // D8: a lifecycle flush asks for every file and reports the answer
    func testAFlushAsksForEveryFileAndSaysWhetherItIsStored() async {
        var sent: [(String, String)] = []
        var reply = #"{"stored":true,"seq":{"epoch":"e","n":1}}"#
        let bridge = NativeBridgeClient(storage: WriteStorageStatus()) { name, args in
            sent.append((name, args))
            return reply
        }
        let stored = await bridge.flushStorage()
        XCTAssertTrue(stored)
        XCTAssertEqual(sent.first?.0, "native/persisted")
        XCTAssertEqual(sent.first?.1, #"{"allFiles":true}"#)
        reply = #"{"stored":false,"seq":{"epoch":"e","n":2}}"#
        let notStored = await bridge.flushStorage()
        XCTAssertFalse(notStored)
    }

    func testAFlushThatFailsReportsNotStored() async {
        let bridge = NativeBridgeClient(storage: WriteStorageStatus()) { _, _ in throw NativeBridgeError.noPage }
        let stored = await bridge.flushStorage()
        XCTAssertFalse(stored)
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
