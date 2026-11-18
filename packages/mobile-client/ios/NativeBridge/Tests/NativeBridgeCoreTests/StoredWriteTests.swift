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
        let result = try await client(status: status) { _ in #"{"stored":false,"seq":4}"# }
            .write("native/account-move", args: move)
        XCTAssertFalse(result.stored)
        XCTAssertEqual(status.message, WriteStorageStatus.notYetStoredMessage)
        status.storedEvent(seq: 3)
        XCTAssertEqual(status.message, WriteStorageStatus.notYetStoredMessage)
        status.storedEvent(seq: 4)
        XCTAssertNil(status.message)
    }

    func testALaterStoredAnswerClearsAnEarlierNotStored() async throws {
        let status = WriteStorageStatus()
        let bridge = client(status: status) { count in
            count == 1 ? #"{"stored":false,"seq":1}"# : #"{"stored":true}"#
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

    func testTheStoredEventCarriesOnlyItsNumber() {
        XCTAssertEqual(NativeBridgeEvent.storedSeq(of: ["event": "stored", "payload": ["seq": 7]]), 7)
        XCTAssertNil(NativeBridgeEvent.storedSeq(of: ["event": "sync-event", "payload": ["seq": 7]]))
        XCTAssertNil(NativeBridgeEvent.storedSeq(of: ["event": "stored", "payload": ["seq": "7"]]))
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
