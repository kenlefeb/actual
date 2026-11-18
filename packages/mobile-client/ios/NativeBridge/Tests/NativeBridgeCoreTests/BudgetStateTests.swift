import XCTest

@testable import NativeBridgeCore

// native-bridge: "The page reports its budget state to the Mac app" (sc-4942)
final class BudgetStateTests: XCTestCase {
    private let cloud = "7f3c2a1e-9b4d-4c6e-8a2f-0d1e2f3a4b5c"

    private func message(_ payload: Any) -> [String: Any] {
        ["event": "budget-state", "payload": payload]
    }

    func testOpenAndClosedCarryTheCloudFileId() {
        XCTAssertEqual(BudgetState.parse(message(["state": "open", "cloudFileId": cloud])), .open(cloud))
        XCTAssertEqual(BudgetState.parse(message(["state": "closed", "cloudFileId": cloud])), .closed(cloud))
    }

    func testTheIdIsKeptLowercased() {
        XCTAssertEqual(BudgetState.parse(message(["state": "open", "cloudFileId": cloud.uppercased()])), .open(cloud))
    }

    func testNoneCarriesNoId() {
        XCTAssertEqual(BudgetState.parse(message(["state": "none"])), BudgetState.none)
    }

    func testEveryOtherShapeIsDropped() {
        let bad: [Any] = [
            message(["state": "open"]),
            message(["state": "open", "cloudFileId": "My-Finances-1a2b3c4"]),
            message(["state": "closed", "cloudFileId": 42]),
            message(["state": "none", "cloudFileId": cloud]),
            message(["state": "deleted", "cloudFileId": cloud]),
            message(["state": "open", "cloudFileId": cloud, "name": "My Finances"]),
            message("open"),
            ["event": "cells-changed", "payload": ["state": "none"]],
            "budget-state",
        ]
        for body in bad {
            XCTAssertNil(BudgetState.parse(body), "\(body)")
        }
    }
}
