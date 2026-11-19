import XCTest

@testable import NativeBridgeCore

// sc-5219: the storage notices in the one notice slot (native-durable-writes,
// tasks 3.1, 3.8, 3.9, 3.12 and 4.5). Times are formatted in UTC for the tests.
@MainActor
final class StorageNoticesTests: XCTestCase {
    private var scheduled: [() -> Void] = []
    private var announced: [String] = []
    private var reloads = 0
    private var clock = StorageNoticesTests.at(15, 0, 0)
    private lazy var slot: WindowNotices = {
        let slot = WindowNotices(
            schedule: { [unowned self] _, work in self.scheduled.append(work) },
            announce: { [unowned self] in self.announced.append($0) })
        slot.pageDidLoad()
        slot.windowChanged(isActive: true)
        return slot
    }()
    private let storage = WriteStorageStatus()
    private lazy var notices = StorageNotices(
        slot: slot, storage: storage, reload: { [unowned self] in self.reloads += 1 },
        now: { [unowned self] in self.clock }, time: StorageNoticesTests.time)

    private static func at(_ hour: Int, _ minute: Int, _ second: Double) -> Date {
        Date(timeIntervalSince1970: 1_800_000_000 - 1_800_000_000.truncatingRemainder(dividingBy: 86_400))
            .addingTimeInterval(Double(hour * 3600 + minute * 60) + second)
    }

    private static func time(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "h:mm:ss a"
        return formatter.string(from: date)
    }

    private func millis(_ date: Date) -> Double { date.timeIntervalSince1970 * 1000 }

    private func firstLoad() {
        notices.pageLoaded()
    }

    private func tap() { slot.tap() }

    // "The failure notice says what was lost" and "The notice's cut-off time is exact"
    func testTheFailureNoticeGivesTheCutOffToTheSecondWithReload() {
        firstLoad()
        notices.failed(lastStoredFlushAt: millis(Self.at(15, 42, 10.9)), quota: false)
        XCTAssertEqual(
            slot.current?.text,
            "Changes can't be saved on this device right now. Reload the app. Changes made after 3:42:10 PM weren't saved and need to be made again.")
        XCTAssertEqual(slot.current?.button, .reload)
        XCTAssertEqual(slot.current?.lifetime, .persistent)
        scheduled.forEach { $0() }
        XCTAssertNotNil(slot.current, "it never hides on its own")
    }

    func testTheFailureNoticeWithNothingStoredThisSession() {
        firstLoad()
        notices.failed(lastStoredFlushAt: nil, quota: false)
        XCTAssertEqual(
            slot.current?.text,
            "Changes can't be saved on this device right now. Reload the app. Changes made since you opened the app weren't saved and need to be made again.")
    }

    func testTheDeviceFullNoticeWithAndWithoutATime() {
        firstLoad()
        notices.failed(lastStoredFlushAt: millis(Self.at(15, 42, 10)), quota: true)
        XCTAssertEqual(
            slot.current?.text,
            "This device is full, so changes can't be saved. Free up some space, then reload the app. Changes made after 3:42:10 PM weren't saved and need to be made again. Saved changes can't sync until there's space.")
        let other = StorageNotices(slot: slot, storage: storage, reload: {}, now: { self.clock }, time: Self.time)
        other.pageLoaded()
        other.failed(lastStoredFlushAt: nil, quota: true)
        XCTAssertEqual(
            slot.current?.text,
            "This device is full, so changes can't be saved. Free up some space, then reload the app. Changes made since you opened the app weren't saved and need to be made again. Saved changes can't sync until there's space.")
    }

    // "Since you opened the app" applies only on the app's first load
    func testAfterAReloadTheLoadTimeStandsInForNothingStored() {
        firstLoad()
        clock = Self.at(16, 0, 30.6)
        notices.pageLoaded()
        notices.failed(lastStoredFlushAt: nil, quota: false)
        XCTAssertEqual(
            slot.current?.text,
            "Changes can't be saved on this device right now. Reload the app. Changes made after 4:00:30 PM weren't saved and need to be made again.")
    }

    // "The failure notice outranks the reload notice"
    func testTheFailureNoticeReplacesTheReloadNotice() {
        firstLoad()
        slot.show(.pageRestarted)
        slot.pageDidLoad()
        XCTAssertEqual(slot.current, .pageRestarted)
        notices.failed(lastStoredFlushAt: nil, quota: false)
        XCTAssertEqual(slot.current?.button, .reload)
    }

    // "The restart notice asks the person to check"
    func testARestartTurnsTheFailureNoticeIntoTheRestartNotice() {
        firstLoad()
        notices.failed(lastStoredFlushAt: millis(Self.at(15, 42, 10)), quota: false)
        notices.restarted()
        slot.show(.pageRestarted)
        notices.pageLoaded()
        slot.pageDidLoad()
        XCTAssertEqual(
            slot.current?.text,
            "The app restarted. Changes made after 3:42:10 PM may not have been saved. Check them, and make again any that are missing.")
        XCTAssertEqual(slot.current?.button, .ok)
        // Repeated restarts keep the same notice and time
        notices.restarted()
        slot.show(.pageRestarted)
        notices.pageLoaded()
        XCTAssertEqual(
            slot.current?.text,
            "The app restarted. Changes made after 3:42:10 PM may not have been saved. Check them, and make again any that are missing.")
    }

    func testTheRestartNoticeWithNothingStored() {
        firstLoad()
        notices.failed(lastStoredFlushAt: nil, quota: false)
        notices.restarted()
        XCTAssertEqual(
            slot.current?.text,
            "The app restarted. Changes made since you opened the app may not have been saved. Check them, and make again any that are missing.")
    }

    // "A restart keeps the device-full reason", though the engine forgets it
    func testARestartKeepsTheDeviceFullReason() {
        firstLoad()
        notices.failed(lastStoredFlushAt: millis(Self.at(15, 42, 10)), quota: true)
        notices.restarted()
        notices.pageLoaded()
        XCTAssertEqual(
            slot.current?.text,
            "The app restarted, and this device is out of space. Free up some space. Changes made after 3:42:10 PM may not have been saved. Check them, and make again any that are missing.")
    }

    // OK ends the restart notice, and later automatic reloads show the reload notice again
    func testOKEndsTheRestartNoticeAndClearsMayNotBeSaved() {
        firstLoad()
        storage.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "old", n: 1)))
        notices.failed(lastStoredFlushAt: nil, quota: false)
        storage.pageLoaded(epoch: "new")
        notices.restarted()
        XCTAssertTrue(storage.mayNotBeSaved)
        tap()
        XCTAssertNil(slot.current)
        XCTAssertFalse(storage.mayNotBeSaved)
        notices.restarted()
        slot.show(.pageRestarted)
        notices.pageLoaded()
        slot.pageDidLoad()
        XCTAssertEqual(slot.current, .pageRestarted)
    }

    // "The person reloads": no restart notice unless one is waiting for OK
    func testReloadEndsTheFailureNoticeAndShowsNoRestartNotice() {
        firstLoad()
        notices.failed(lastStoredFlushAt: nil, quota: false)
        tap()
        XCTAssertEqual(reloads, 1)
        XCTAssertNil(slot.current)
        notices.pageLoaded()
        XCTAssertNil(slot.current)
    }

    // "The restart notice keeps the earliest cut-off"
    func testALaterFailureUsesItsOwnCutOffAndTheRestartNoticeComesBackWithTheEarliest() {
        firstLoad()
        notices.failed(lastStoredFlushAt: millis(Self.at(15, 42, 10)), quota: false)
        notices.restarted()
        notices.pageLoaded()
        notices.failed(lastStoredFlushAt: millis(Self.at(15, 50, 0)), quota: false)
        XCTAssertEqual(
            slot.current?.text,
            "Changes can't be saved on this device right now. Reload the app. Changes made after 3:50:00 PM weren't saved and need to be made again.")
        tap()
        notices.pageLoaded()
        XCTAssertEqual(
            slot.current?.text,
            "The app restarted. Changes made after 3:42:10 PM may not have been saved. Check them, and make again any that are missing.")
    }

    // "A restart with unconfirmed writes tells the person", in place of the reload notice
    func testAPossibleLossShowsTheRestartNoticeWithOK() {
        firstLoad()
        slot.show(.pageRestarted)
        storage.record(PersistedAnswer(stored: false, seq: PersistedSeq(epoch: "old", n: 1)))
        storage.pageLoaded(epoch: "new")
        slot.pageDidLoad()
        XCTAssertEqual(
            slot.current?.text,
            "The app restarted. Some recent changes may not have been saved. Check them, and make again any that are missing.")
        XCTAssertEqual(slot.current?.button, .ok)
        XCTAssertEqual(announced.filter { $0 == slot.current?.text }.count, 1, "announced once")
        tap()
        XCTAssertNil(slot.current)
        XCTAssertFalse(storage.mayNotBeSaved)
    }

    // "A closed budget's failed write is reported", after a showing failure notice
    func testTheClosedBudgetNoticeFollowsTheFailureNotice() {
        firstLoad()
        notices.failed(lastStoredFlushAt: nil, quota: false)
        notices.closeFailed()
        XCTAssertEqual(slot.current?.button, .reload)
        tap()
        XCTAssertEqual(
            slot.current?.text, "Some recent changes to the budget you closed weren't saved. Open it and make them again.")
        XCTAssertEqual(slot.current?.button, .ok)
        tap()
        XCTAssertNil(slot.current)
    }

    func testTheClosedBudgetNoticeOnItsOwn() {
        firstLoad()
        notices.closeFailed()
        XCTAssertEqual(slot.current?.button, .ok)
        tap()
        XCTAssertNil(slot.current)
    }

    func testStorageFailedEventsAreRead() {
        let failure = NativeBridgeEvent.storageFailure(of: [
            "event": "storage-failed", "payload": ["lastStoredFlushAt": 1_800_000_000_500, "quota": true],
        ])
        XCTAssertEqual(failure?.lastStoredFlushAt, 1_800_000_000_500)
        XCTAssertEqual(failure?.quota, true)
        let none = NativeBridgeEvent.storageFailure(of: [
            "event": "storage-failed", "payload": ["lastStoredFlushAt": NSNull(), "quota": false],
        ])
        XCTAssertNotNil(none)
        XCTAssertNil(none?.lastStoredFlushAt)
        XCTAssertNil(NativeBridgeEvent.storageFailure(of: ["event": "sync-event", "payload": [:]]))
    }
}
