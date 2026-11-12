import Foundation
import XCTest

@testable import NativeBridgeCore

// native-bridge: "The native Budget screen's write handlers are allowlisted",
// "Bridge writes are validated before loot-core runs them", "The origin guard
// covers the write names"; native-budget-screen: "Budgeted amounts are edited
// through loot-core" (sc-3769). Fake transport, contract fixtures.
private let fixturesDir = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()  // NativeBridgeCoreTests
    .deletingLastPathComponent()  // Tests
    .deletingLastPathComponent()  // NativeBridge
    .deletingLastPathComponent()  // ios
    .deletingLastPathComponent()  // mobile-client
    .deletingLastPathComponent()  // packages
    .appendingPathComponent("loot-core/src/server/native/fixtures")

private func fixtureJSON(_ name: String) throws -> String {
    String(decoding: try Data(contentsOf: fixturesDir.appendingPathComponent("\(name).json")), as: UTF8.self)
}

private var utc: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    return calendar
}

private let march9: () -> Date = {
    DateComponents(calendar: utc, year: 2026, month: 3, day: 9).date!
}

private struct Boom: Error {}

final class WriteAllowlistTests: XCTestCase {
    func testBudgetAmountIsAllowlistedAndForwarded() async throws {
        var seen: (String, String)?
        let client = NativeBridgeClient { name, args in
            seen = (name, args)
            return "null"
        }
        _ = try await client.call("budget/budget-amount", args: ["category": "rent"])
        XCTAssertEqual(seen?.0, "budget/budget-amount")
    }

    func testOtherWriteHandlersAreStillRefused() async {
        for name in ["budget/set-zero", "budget/cover-overspending", "budget/transfer-category", "budget/transfer-available"] {
            var calls = 0
            let client = NativeBridgeClient { _, _ in
                calls += 1
                return "null"
            }
            do {
                _ = try await client.call(name)
                XCTFail("expected a refusal for \(name)")
            } catch NativeBridgeError.notAllowlisted(let refused) {
                XCTAssertEqual(refused, name)
            } catch {
                XCTFail("unexpected error \(error)")
            }
            XCTAssertEqual(calls, 0)
        }
    }
}

final class TypedArgumentsTests: XCTestCase {
    func testANumberArrivesAtThePageAsANumber() async throws {
        var seenArgs = ""
        let client = NativeBridgeClient { _, args in
            seenArgs = args
            return "null"
        }
        try await client.setBudgetAmount(BudgetAmountWrite(category: "rent", month: "2026-03", amount: 12500))
        let object = try JSONSerialization.jsonObject(with: Data(seenArgs.utf8)) as? [String: Any]
        XCTAssertEqual(object?["amount"] as? Int, 12500)
        XCTAssertFalse(seenArgs.contains(#""amount":"12500""#))
        XCTAssertEqual(object?["category"] as? String, "rent")
        XCTAssertEqual(object?["month"] as? String, "2026-03")
    }

    func testAStringArgumentCallStillWorks() async throws {
        var seenArgs = ""
        let client = NativeBridgeClient { _, args in
            seenArgs = args
            return "{}"
        }
        _ = try await client.call("native/budget-month", args: ["month": "2026-03"])
        XCTAssertEqual(seenArgs, #"{"month":"2026-03"}"#)
    }

    func testACallWithNoArgumentsSendsAnEmptyObject() async throws {
        var seenArgs = ""
        let client = NativeBridgeClient { _, args in
            seenArgs = args
            return "{}"
        }
        _ = try await client.call("query")
        XCTAssertEqual(seenArgs, "{}")
    }
}

final class BudgetAmountWriteTests: XCTestCase {
    private func assertRefused(_ make: () throws -> BudgetAmountWrite, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertThrowsError(try make(), file: file, line: line) { error in
            guard case NativeBridgeError.invalidWrite = error else {
                return XCTFail("expected invalidWrite, got \(error)", file: file, line: line)
            }
        }
    }

    func testAValidWriteIsBuilt() throws {
        let write = try BudgetAmountWrite(category: "rent", month: "2026-03", amount: -500)
        XCTAssertEqual(write.amount, -500)
    }

    func testAnAmountBeyondWhatLootCoreCanHoldIsRefused() {
        assertRefused { try BudgetAmountWrite(category: "rent", month: "2026-03", amount: 9_007_199_254_740_992) }
        assertRefused { try BudgetAmountWrite(category: "rent", month: "2026-03", amount: -9_007_199_254_740_992) }
        XCTAssertNoThrow(try BudgetAmountWrite(category: "rent", month: "2026-03", amount: 9_007_199_254_740_991))
    }

    func testAMonthThatIsNotYearDashMonthIsRefused() {
        for month in ["2026-3", "2026-13", "2026-00", "march", "", "2026-03-01", " 2026-03"] {
            assertRefused { try BudgetAmountWrite(category: "rent", month: month, amount: 1) }
        }
    }

    func testAnEmptyOrToBudgetIdIsRefused() {
        assertRefused { try BudgetAmountWrite(category: "", month: "2026-03", amount: 1) }
        assertRefused { try BudgetAmountWrite(category: "to-budget", month: "2026-03", amount: 1) }
    }

    func testARefusedWriteNeverReachesTheTransport() async {
        var calls = 0
        let client = NativeBridgeClient { _, _ in
            calls += 1
            return "null"
        }
        let write = try? BudgetAmountWrite(category: "rent", month: "2026-3", amount: 1)
        XCTAssertNil(write)
        XCTAssertEqual(calls, 0)
        _ = client
    }
}

// The guard is the same for every name, so this pins that the three write
// names get no exception: only the app's own main frame passes
final class WriteOriginGuardTests: XCTestCase {
    private let server = URL(string: "https://app.example.com")!
    private let writeNames = ["budget/budget-amount", "budget/transfer-category", "budget/transfer-available"]

    private func accepts(main: Bool = true, scheme: String = "https", host: String = "app.example.com", port: Int = 0) -> Bool {
        PageOriginGuard.accepts(isMainFrame: main, scheme: scheme, host: host, port: port, serverURL: server)
    }

    func testAWriteFromAnotherFrameHostSchemeOrPortIsIgnored() {
        for name in writeNames {
            XCTAssertFalse(accepts(main: false), "subframe: \(name)")
            XCTAssertFalse(accepts(host: "tenant.auth0.com"), "host: \(name)")
            XCTAssertFalse(accepts(scheme: "http"), "scheme: \(name)")
            XCTAssertFalse(accepts(port: 8443), "port: \(name)")
        }
    }

    func testAWriteFromTheAppsOwnPageIsAccepted() {
        XCTAssertTrue(accepts())
    }
}

@MainActor
final class BudgetSaveTests: XCTestCase {
    private func envelope() throws -> String { try fixtureJSON("budget-month-envelope") }

    // First read answers with the fixture; the re-read after a write with `afterWrite`
    private func loadedModel(
        afterWrite: String? = nil, writeError: Error? = nil, hangWrite: Bool = false, fixture: String = "budget-month-envelope",
        calls: @escaping (String, String) -> Void
    ) async throws -> BudgetViewModel {
        let json = try fixtureJSON(fixture)
        let model = BudgetViewModel(
            client: NativeBridgeClient(timeout: hangWrite ? 0.1 : 1) { name, args in
                calls(name, args)
                if name == "budget/budget-amount" {
                    if let writeError { throw writeError }
                    if hangWrite { await withCheckedContinuation { (_: CheckedContinuation<Void, Never>) in } }
                    return "null"
                }
                return afterWrite ?? json
            }, now: march9, calendar: utc)
        await model.load()
        return model
    }

    func testSavingCallsTheWriteThenReadsTheMonthAgain() async throws {
        var seen: [(String, String)] = []
        var reread = try envelope()
        reread = reread.replacingOccurrences(of: #""budgeted": 150000"#, with: #""budgeted": 12500"#)
        let model = try await loadedModel(afterWrite: reread) { seen.append(($0, $1)) }
        let saved = await model.saveBudgeted(category: "rent", text: "125.00")
        XCTAssertTrue(saved)
        XCTAssertEqual(seen.map(\.0), ["native/budget-month", "budget/budget-amount", "native/budget-month"])
        let write = try JSONSerialization.jsonObject(with: Data(seen[1].1.utf8)) as? [String: Any]
        XCTAssertEqual(write?["amount"] as? Int, 12500)
        XCTAssertEqual(write?["category"] as? String, "rent")
        XCTAssertEqual(write?["month"] as? String, "2026-03")
        guard case .loaded(let month) = model.state else { return XCTFail("expected loaded") }
        XCTAssertEqual(month.groups.first?.categories.last?.budgeted, 12500)
        XCTAssertNil(model.saveError)
    }

    func testAFailedSaveKeepsTheOldValueAndShowsAnError() async throws {
        var seen: [String] = []
        let model = try await loadedModel(writeError: Boom()) { name, _ in seen.append(name) }
        let before = model.state
        let saved = await model.saveBudgeted(category: "rent", text: "125.00")
        XCTAssertFalse(saved)
        XCTAssertEqual(model.state, before)
        XCTAssertEqual(model.saveError, .failed)
        // No re-read, and no retry of the write
        XCTAssertEqual(seen, ["native/budget-month", "budget/budget-amount"])
    }

    func testATimedOutSaveKeepsTheOldValueAndSaysSo() async throws {
        let model = try await loadedModel(hangWrite: true) { _, _ in }
        let before = model.state
        let saved = await model.saveBudgeted(category: "rent", text: "125.00")
        XCTAssertFalse(saved)
        XCTAssertEqual(model.state, before)
        XCTAssertEqual(model.saveError, .timedOut)
    }

    func testASaveWhoseReReadFailsKeepsTheOldNumbersAndIsNotRetried() async throws {
        var reads = 0
        var writes = 0
        let json = try envelope()
        let model = BudgetViewModel(
            client: NativeBridgeClient { name, _ in
                if name == "budget/budget-amount" {
                    writes += 1
                    return "null"
                }
                reads += 1
                if reads > 1 { throw Boom() }
                return json
            }, now: march9, calendar: utc)
        await model.load()
        let before = model.state
        let saved = await model.saveBudgeted(category: "rent", text: "125.00")
        XCTAssertTrue(saved)
        XCTAssertEqual(model.state, before)
        XCTAssertEqual(model.saveError, .refreshFailed)
        XCTAssertEqual(writes, 1)
    }

    func testAnIdOrMonthNotInTheSnapshotIsNeverSent() async throws {
        var writes = 0
        let model = try await loadedModel { name, _ in if name == "budget/budget-amount" { writes += 1 } }
        // an unknown id, a group id, an income category, the literal to-budget, an empty id
        for id in ["nope", "bills", "salary", "to-budget", ""] {
            let saved = await model.saveBudgeted(category: id, text: "1")
            XCTAssertFalse(saved, id)
        }
        XCTAssertEqual(writes, 0)
    }

    func testNothingIsSentBeforeAMonthIsLoaded() async {
        var writes = 0
        let model = BudgetViewModel(client: NativeBridgeClient { _, _ in writes += 1; return "null" }, now: march9, calendar: utc)
        let saved = await model.saveBudgeted(category: "rent", text: "1")
        XCTAssertFalse(saved)
        XCTAssertEqual(writes, 0)
    }

    func testTextThatIsNotAnAmountIsNeverSent() async throws {
        var writes = 0
        let model = try await loadedModel { name, _ in if name == "budget/budget-amount" { writes += 1 } }
        for text in ["", "abc", "1.234", "1,2,3x", "--5", "1e3", "NaN"] {
            let saved = await model.saveBudgeted(category: "rent", text: text)
            XCTAssertFalse(saved, text)
        }
        XCTAssertEqual(writes, 0)
        XCTAssertEqual(model.saveError, .invalidAmount)
    }

    func testTheEditFieldUsesTheSnapshotsDecimalPlaces() async throws {
        var amounts: [Int] = []
        // The yen budget has 0 decimal places and dot-comma formatting
        let model = try await loadedModel(fixture: "budget-month-envelope-jpy") { name, args in
            if name == "budget/budget-amount",
                let object = try? JSONSerialization.jsonObject(with: Data(args.utf8)) as? [String: Any],
                let amount = object["amount"] as? Int
            {
                amounts.append(amount)
            }
        }
        _ = await model.saveBudgeted(category: "rent", text: "1.500")
        _ = await model.saveBudgeted(category: "rent", text: "1500")
        XCTAssertEqual(amounts, [1500, 1500])
    }
}

final class BudgetAmountInputTests: XCTestCase {
    private func style(places: Int = 2, format: BudgetMonth.NumberFormat = .commaDot, symbol: String = "", code: String = "") -> BudgetAmountStyle {
        BudgetAmountStyle(
            currencyCode: code, currencySymbol: symbol, decimalPlaces: places, symbolPosition: .before, symbolSpace: false,
            numberFormat: format, hideFraction: false)
    }

    func testTypedTextBecomesMinorUnits() {
        let s = style()
        XCTAssertEqual(BudgetAmountFormat.minorUnits(from: "125", style: s), 12500)
        XCTAssertEqual(BudgetAmountFormat.minorUnits(from: "125.5", style: s), 12550)
        XCTAssertEqual(BudgetAmountFormat.minorUnits(from: "1,250.05", style: s), 125005)
        XCTAssertEqual(BudgetAmountFormat.minorUnits(from: "-12.34", style: s), -1234)
        XCTAssertEqual(BudgetAmountFormat.minorUnits(from: "0", style: s), 0)
        XCTAssertEqual(BudgetAmountFormat.minorUnits(from: " 7 ", style: s), 700)
    }

    func testTheSeparatorsFollowTheBudgetsNumberFormat() {
        XCTAssertEqual(BudgetAmountFormat.minorUnits(from: "1.250,05", style: style(format: .dotComma)), 125005)
        XCTAssertEqual(BudgetAmountFormat.minorUnits(from: "1\u{202F}250,05", style: style(format: .spaceComma)), 125005)
        XCTAssertEqual(BudgetAmountFormat.minorUnits(from: "1\u{2019}250.05", style: style(format: .apostropheDot)), 125005)
    }

    func testAZeroDecimalCurrencyTakesWholeUnits() {
        let yen = style(places: 0, format: .dotComma, symbol: "¥", code: "JPY")
        XCTAssertEqual(BudgetAmountFormat.minorUnits(from: "1500", style: yen), 1500)
        XCTAssertEqual(BudgetAmountFormat.minorUnits(from: "1.500", style: yen), 1500)
        XCTAssertNil(BudgetAmountFormat.minorUnits(from: "1500,5", style: yen))
    }

    func testTheCurrencySymbolIsIgnored() {
        XCTAssertEqual(BudgetAmountFormat.minorUnits(from: "$12.50", style: style(symbol: "$", code: "USD")), 1250)
    }

    func testTextThatIsNotARepresentableAmountIsNil() {
        let s = style()
        for text in ["", "  ", "abc", "1.234", "--5", "1e3", "1..2", ".", "-", "9999999999999999999"] {
            XCTAssertNil(BudgetAmountFormat.minorUnits(from: text, style: s), text)
        }
    }

    func testTheEditTextRoundTrips() {
        for (places, format) in [(2, BudgetMonth.NumberFormat.commaDot), (2, .dotComma), (0, .dotComma), (3, .commaDot)] {
            let s = style(places: places, format: format)
            for value in [0, 5, -250, 150000, 123456789] {
                let text = BudgetAmountFormat.editString(value, style: s)
                XCTAssertEqual(BudgetAmountFormat.minorUnits(from: text, style: s), value, "\(value) as \(text)")
            }
        }
    }
}
