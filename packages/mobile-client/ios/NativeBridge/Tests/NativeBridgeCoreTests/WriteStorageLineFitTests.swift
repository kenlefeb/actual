import XCTest

@testable import NativeBridgeCore

// sc-5296 (Designer, PR 494): while the keyboard is up the storage line takes
// at most a third of the space above it, full, short or not at all
final class WriteStorageLineFitTests: XCTestCase {
    private let available: CGFloat = 300

    func testTheFullTextWhenItTakesAThirdOrLess() {
        XCTAssertEqual(WriteStorageLineFit.choose(fullHeight: 100, shortHeight: 30, available: available), .full)
        XCTAssertEqual(WriteStorageLineFit.choose(fullHeight: 40, shortHeight: 30, available: available), .full)
    }

    func testTheShortFormJustOverAThird() {
        XCTAssertEqual(WriteStorageLineFit.choose(fullHeight: 100.5, shortHeight: 100, available: available), .short)
    }

    func testHiddenWhenEvenTheShortFormIsOverAThird() {
        XCTAssertEqual(WriteStorageLineFit.choose(fullHeight: 200, shortHeight: 100.5, available: available), .hidden)
    }

    // story 5383 (the Designer's rule): hidden while a context menu, alert or
    // confirmation is open; visible over sheets and full-screen screens
    func testWhatTheLineStepsAsideFor() {
        XCTAssertTrue(WriteStorageLineFit.stepsAside(isAlert: true, isSheet: false, isFullScreen: false), "an alert or confirmation")
        XCTAssertTrue(WriteStorageLineFit.stepsAside(isAlert: false, isSheet: false, isFullScreen: false), "a context menu")
        XCTAssertFalse(WriteStorageLineFit.stepsAside(isAlert: false, isSheet: true, isFullScreen: false), "a sheet")
        XCTAssertFalse(WriteStorageLineFit.stepsAside(isAlert: false, isSheet: false, isFullScreen: true), "a full-screen screen")
    }

    func testTheShortForms() {
        XCTAssertEqual(WriteStorageLineFit.shortForm(of: WriteStorageStatus.notYetStoredMessage), "Still saving…")
        XCTAssertEqual(WriteStorageLineFit.shortForm(of: WriteStorageStatus.savingMessage), WriteStorageStatus.savingMessage)
    }
}
