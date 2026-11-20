#if DEBUG
import SwiftUI
import UIKit

// Test-only (sc-5504). The UI-test target launches the app with
// `-UITestPaycheckEditor YES`: the window's root is then the native paycheck
// editor, adding a paycheck, over a fake transport that answers the pickers
// with nothing and the preview with a net pay of zero. No web view, no budget,
// no sign-in, no network. Debug builds only.
enum UITestPaycheckEditor {
    static var isOn: Bool { UserDefaults.standard.bool(forKey: "UITestPaycheckEditor") }

    @MainActor static func makeRoot() -> UIViewController {
        let client = NativeBridgeClient { name, _ in
            switch name {
            case "query": return #"{"data":[]}"#
            case "native/paycheck-preview": return #"{"netAmount":0,"payDate":null,"employerName":null,"deposits":[],"errors":[]}"#
            default: return "null"
            }
        }
        UIView.setAnimationsEnabled(false)
        let style = BudgetAmountStyle(
            currencyCode: "USD", currencySymbol: "$", decimalPlaces: 2, symbolPosition: .before, symbolSpace: false,
            numberFormat: .commaDot, hideFraction: false)
        return UIHostingController(
            rootView: PaycheckEditorSheet(request: PaycheckEditorRequest(paycheckId: nil), client: client, style: style, onWrite: { _ in }))
    }
}
#endif
