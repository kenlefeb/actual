import Foundation
import XCTest

@testable import NativeBridgeCore

// native-paychecks-screen (sc-4343): the editor's view model against a fake
// page transport and the loot-core fixtures. Swift edits fields and shows
// loot-core's answers; it decides nothing about a paycheck.
@MainActor
private final class FakeEditorPage {
    var calls: [(name: String, args: String)] = []
    var failures: [String: Error] = [:]
    var previews: [String] = []
    // Holds the next preview answer until released
    var holdPreview = false
    var held: [CheckedContinuation<Void, Never>] = []
    var hasStoredPaycheck = true
    var yearToDate: String

    init() throws {
        let preview = String(decoding: try editorFixture("paycheck-preview"), as: UTF8.self)
        previews = [preview]
        yearToDate = String(decoding: try editorFixture("paycheck-year-to-date"), as: UTF8.self)
    }

    var client: NativeBridgeClient {
        NativeBridgeClient(timeout: 5) { name, args in
            // The answer is picked when the call arrives, so a held call keeps its own
            let (hold, answer) = await MainActor.run { () -> (Bool, Result<String, Error>) in
                self.calls.append((name, args))
                return (
                    name == "native/paycheck-preview" && self.holdPreview, Result { try self.answer(name, args) }
                )
            }
            if hold {
                await withCheckedContinuation { continuation in
                    Task { @MainActor in self.held.append(continuation) }
                }
            }
            return try answer.get()
        }
    }

    private func answer(_ name: String, _ args: String) throws -> String {
        if let failure = failures[name] { throw failure }
        switch name {
        case "native/paycheck-preview":
            // Answers in the order asked, the last one repeating
            return previews.count > 1 ? previews.removeFirst() : previews[0]
        case "paycheck-year-to-date": return yearToDate
        case "native/paycheck-save": return #""acme""#
        case "native/schedules-paychecks": return String(decoding: try paychecksFixture(), as: UTF8.self)
        case "query":
            if args.contains(#""table":"paychecks""#) {
                return hasStoredPaycheck ? #"{"data":[{"id":"acme","name":"Acme","definition":\#(acmeDefinitionJSON)}]}"# : #"{"data":[]}"#
            }
            if args.contains(#""table":"accounts""#) {
                return #"{"data":[{"id":"checking","name":"Checking","offbudget":false,"closed":false},{"id":"old","name":"Old","offbudget":false,"closed":true}]}"#
            }
            if args.contains(#""table":"payees""#) { return #"{"data":[{"id":"acme","name":"Acme"}]}"# }
            return #"{"data":[{"id":"income","name":"Income","is_income":true,"hidden":false}]}"#
        default: return "null"
        }
    }

    func count(_ name: String) -> Int { calls.filter { $0.name == name }.count }
    func args(_ name: String) -> [String] { calls.filter { $0.name == name }.map(\.args) }
}

private struct Boom: Error {}

private func previewJSON(net: Int, errors: [(String, String)] = []) -> String {
    let list = errors.map { #"{"code":"\#($0.0)","field":"\#($0.1)"}"# }.joined(separator: ",")
    return #"{"netAmount":\#(net),"payDate":"2026-11-13","employerName":"Acme","deposits":[],"errors":[\#(list)]}"#
}

@MainActor
final class PaycheckEditorViewModelTests: XCTestCase {
    private func model(
        _ page: FakeEditorPage, id: String? = "acme", onWrite: @escaping (PaychecksUndoOffer) -> Void = { _ in }
    ) -> PaycheckEditorViewModel {
        PaycheckEditorViewModel(client: page.client, paycheckId: id, today: "2026-11-01", debounce: 0.01, onWrite: onWrite)
    }

    func testLoadsTheStoredPaycheckItsYearToDateAndAPreview() async throws {
        let page = try FakeEditorPage()
        let model = model(page)
        await model.start()
        XCTAssertEqual(model.state, .ready)
        XCTAssertEqual(model.draft.name, "Acme")
        XCTAssertEqual(model.draft.definition.paySchedule, "pay")
        XCTAssertEqual(model.options.accounts.map(\.id), ["checking", "old"])
        XCTAssertEqual(model.options.openAccounts.map(\.id), ["checking"])
        XCTAssertEqual(model.yearToDate?.map(\.hasHistory), [false, true])
        XCTAssertFalse(model.isYearToDateEmpty)
        XCTAssertEqual(model.preview?.netAmount, 240000)
        XCTAssertFalse(model.hasChanges)
        XCTAssertTrue(model.canSave)
    }

    func testANewPaycheckStartsAsTheWebFormDoes() async throws {
        let page = try FakeEditorPage()
        let model = model(page, id: nil)
        await model.start()
        XCTAssertTrue(model.isNew)
        XCTAssertTrue(model.draft.isNewAccount)
        XCTAssertEqual(model.draft.definition.deposits.map(\.kind), ["remainder"])
        XCTAssertNil(model.yearToDate)
        XCTAssertEqual(page.count("paycheck-year-to-date"), 0)
        XCTAssertEqual(model.defaultClearingName, "Acme Paycheck")
    }

    func testAPaycheckDeletedElsewhereIsGone() async throws {
        let page = try FakeEditorPage()
        page.hasStoredPaycheck = false
        let model = model(page)
        await model.start()
        XCTAssertEqual(model.state, .gone)
    }

    func testYearToDateIsEmptyOnlyByHasHistory() async throws {
        let page = try FakeEditorPage()
        page.yearToDate = #"[{"year":2026,"gross":0,"deductions":[],"net":0,"hasHistory":false},{"year":2025,"gross":0,"deductions":[],"net":0,"hasHistory":false}]"#
        let model = model(page)
        await model.start()
        XCTAssertTrue(model.isYearToDateEmpty)
    }

    func testDebouncesThePreviewAndKeepsOnlyTheLatestAnswer() async throws {
        let page = try FakeEditorPage()
        let model = model(page)
        await model.start()
        let before = page.count("native/paycheck-preview")
        page.holdPreview = true
        page.previews = [previewJSON(net: 1), previewJSON(net: 2)]
        // A burst of edits sends one preview, for the last draft
        model.update { $0.definition.grossAmount = 1 }
        model.update { $0.definition.grossAmount = 2 }
        XCTAssertFalse(model.canSave)
        try await waitUntil("one preview asked", limit: 100_000) { page.held.count == 1 }
        XCTAssertEqual(page.count("native/paycheck-preview") - before, 1)
        XCTAssertTrue(page.args("native/paycheck-preview").last!.contains(#""grossAmount":2"#))
        // Another edit while it is pending: its answer is the one kept
        model.update { $0.definition.grossAmount = 3 }
        try await waitUntil("second preview asked", limit: 100_000) { page.held.count == 2 }
        page.held[1].resume()
        try await waitUntil("latest answer", limit: 100_000) { model.preview?.netAmount == 2 }
        page.held[0].resume()
        for _ in 0..<200 { await Task.yield() }
        XCTAssertEqual(model.preview?.netAmount, 2)
        XCTAssertTrue(model.isPreviewCurrent)
    }

    func testShowsErrorsByFieldAndDisablesSave() async throws {
        let page = try FakeEditorPage()
        let model = model(page)
        await model.start()
        page.previews = [previewJSON(net: -10000, errors: [("deductions-exceed-gross", "deductions"), ("name-missing", "name")])]
        model.update { $0.definition.grossAmount = 1 }
        try await waitUntil("preview", limit: 100_000) { model.isPreviewCurrent }
        XCTAssertEqual(model.errors(for: .deductions), ["Deductions exceed gross pay."])
        XCTAssertEqual(model.errors(for: .name), ["Enter a name for the paycheck."])
        XCTAssertEqual(model.errors(for: .deposits), [])
        XCTAssertEqual(model.announcement, "Deductions exceed gross pay. Enter a name for the paycheck.")
        XCTAssertFalse(model.canSave)
    }

    func testSavesOnceAndOffersUndoOnlyOnSuccess() async throws {
        let page = try FakeEditorPage()
        var offers: [PaychecksUndoOffer] = []
        let model = model(page) { offers.append($0) }
        await model.start()
        model.setDaysEarly(3, for: "savings")
        model.setDaysEarly(1, for: "gone")
        try await waitUntil("preview", limit: 100_000) { model.isPreviewCurrent }
        XCTAssertTrue(model.hasChanges)

        let closed = await model.save()

        XCTAssertTrue(closed)
        let sent = try JSONSerialization.jsonObject(with: Data(page.args("native/paycheck-save")[0].utf8)) as! [String: Any]
        XCTAssertEqual(sent["id"] as? String, "acme")
        // Only accounts the paycheck still deposits to
        XCTAssertEqual(sent["daysEarly"] as? [String: Int], ["savings": 3])
        XCTAssertEqual(offers.map(\.token), [sent["undoToken"] as! String])
        XCTAssertEqual(offers.map(\.action), [.save])
    }

    func testARefusedSaveKeepsTheSheetAndShowsLootCoresMessage() async throws {
        let page = try FakeEditorPage()
        var offers = 0
        let model = model(page) { _ in offers += 1 }
        await model.start()
        page.failures["native/paycheck-save"] = NativeBridgeError.page(#"A schedule named "Acme → Savings" already exists"#)
        let closed = await model.save()
        XCTAssertFalse(closed)
        XCTAssertEqual(model.actionError, #"A schedule named "Acme → Savings" already exists"#)
        XCTAssertEqual(model.draft.name, "Acme")
        XCTAssertEqual(offers, 0)

        page.failures["native/paycheck-save"] = NativeBridgeError.page("native/paycheck-save: invalid draft: name-missing, no-deposits")
        _ = await model.save()
        XCTAssertEqual(model.actionError, "Enter a name for the paycheck. Add at least one direct deposit.")

        page.failures["native/paycheck-save"] = NativeBridgeError.timedOut("native/paycheck-save")
        _ = await model.save()
        XCTAssertEqual(model.actionError, PaycheckEditorViewModel.timedOut)

        page.failures["native/paycheck-save"] = NativeBridgeError.page("native bridge: no such account")
        _ = await model.save()
        XCTAssertEqual(model.actionError, PaycheckEditorViewModel.failed)
    }

    func testSaveIsDisabledWhileSaving() async throws {
        let page = try FakeEditorPage()
        let model = model(page)
        await model.start()
        let first = Task { await model.save() }
        try await waitUntil("saving", limit: 100_000) { model.isSaving }
        XCTAssertFalse(model.canSave)
        let second = await model.save()
        XCTAssertFalse(second)
        _ = await first.value
        XCTAssertEqual(page.count("native/paycheck-save"), 1)
    }

    func testANewPaycheckSendsItsClearingAccountName() async throws {
        let page = try FakeEditorPage()
        let model = model(page, id: nil)
        await model.start()
        model.update { $0.name = "Acme" }
        try await waitUntil("preview", limit: 100_000) { model.isPreviewCurrent }
        _ = await model.save()
        let sent = try JSONSerialization.jsonObject(with: Data(page.args("native/paycheck-save")[0].utf8)) as! [String: Any]
        XCTAssertNil(sent["id"])
        XCTAssertEqual(sent["newClearingAccountName"] as? String, "Acme Paycheck")
    }

    func testDeletesAndOffersUndo() async throws {
        let page = try FakeEditorPage()
        var offers: [PaychecksUndoOffer] = []
        let model = model(page) { offers.append($0) }
        await model.start()
        let closed = await model.delete()
        XCTAssertTrue(closed)
        let sent = try JSONSerialization.jsonObject(with: Data(page.args("paycheck-delete")[0].utf8)) as! [String: String]
        XCTAssertEqual(sent["id"], "acme")
        XCTAssertEqual(offers.map(\.token), [sent["undoToken"]!])
        XCTAssertEqual(offers.map(\.action), [.delete])
    }

    func testAFailedDeleteKeepsTheSheet() async throws {
        let page = try FakeEditorPage()
        var offers = 0
        let model = model(page) { _ in offers += 1 }
        await model.start()
        page.failures["paycheck-delete"] = NativeBridgeError.timedOut("paycheck-delete")
        let closed = await model.delete()
        XCTAssertFalse(closed)
        XCTAssertEqual(model.actionError, PaycheckEditorViewModel.timedOut)
        XCTAssertEqual(offers, 0)
    }

    func testANewPaycheckHasNoDelete() async throws {
        let page = try FakeEditorPage()
        let model = model(page, id: nil)
        await model.start()
        let closed = await model.delete()
        XCTAssertFalse(closed)
        XCTAssertEqual(page.count("paycheck-delete"), 0)
    }

    func testHasChangesForTheCancelConfirmation() async throws {
        let page = try FakeEditorPage()
        let model = model(page)
        await model.start()
        XCTAssertFalse(model.hasChanges)
        model.update { $0.definition.deductions[0].amount = 1 }
        XCTAssertTrue(model.hasChanges)
        model.update { $0.definition.deductions[0].amount = 60000 }
        XCTAssertFalse(model.hasChanges)
    }

    // "Native writes offer Undo briefly": the list offers Undo for the
    // editor's write, and its Undo sends exactly that write's token
    func testUndoAfterSaveAndDeleteGoesThroughTheList() async throws {
        let page = try FakeEditorPage()
        let list = PaychecksViewModel(client: page.client, undoInterval: 60, changeInterval: 0.001)
        await list.load()
        for action in ["save", "delete"] {
            let model = model(page) { offer in Task { await list.wrote(offer) } }
            await model.start()
            let ok = action == "save" ? await model.save() : await model.delete()
            XCTAssertTrue(ok)
            try await waitUntil("offer", limit: 100_000) { list.undoOffer != nil }
            let name = action == "save" ? "native/paycheck-save" : "paycheck-delete"
            let token = (try JSONSerialization.jsonObject(with: Data(page.args(name).last!.utf8)) as! [String: Any])["undoToken"] as! String
            XCTAssertEqual(list.undoOffer?.token, token)
            await list.undo()
            XCTAssertEqual(page.args("native/undo").last, #"{"token":"\#(token)"}"#)
            XCTAssertNil(list.undoOffer)
        }
    }

    func testAFailedUndoShowsAnErrorAndKeepsTheValues() async throws {
        let page = try FakeEditorPage()
        let list = PaychecksViewModel(client: page.client, undoInterval: 60, changeInterval: 0.001)
        await list.load()
        let values = list.state
        await list.wrote(PaychecksUndoOffer(token: "S", paycheckName: "Acme", date: "", action: .save))
        page.failures["native/undo"] = NativeBridgeError.page("native/undo: nothing to undo")
        await list.undo()
        XCTAssertEqual(list.actionError, .undoFailed)
        XCTAssertEqual(list.state, values)
        XCTAssertNil(list.undoOffer)
    }

    func testAFailedStartShowsTheError() async throws {
        let page = try FakeEditorPage()
        page.failures["query"] = NativeBridgeError.timedOut("query")
        let model = model(page)
        await model.start()
        XCTAssertEqual(model.state, .failed(.timedOut))
        XCTAssertFalse(model.canSave)
    }
}
