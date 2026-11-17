#if DEBUG
import Foundation

// Test-only (sc-4801): sample data for checking the Reconcile screens in the
// Simulator without a budget, e.g. `-ReconcileDemo checklist` (or `step1`,
// `step2`). Never in a Release build; the real flow reads loot-core.
enum ReconcileDemo {
    static var request: PresentReconcile? {
        switch UserDefaults.standard.string(forKey: "ReconcileDemo") {
        case "checklist": .checklist
        case "step1", "step2", "b2-step3", "b2-adjust", "b2-step4", "b2-done", "b2-moved": .account("checking")
        default: nil
        }
    }

    static var mode: String { UserDefaults.standard.string(forKey: "ReconcileDemo") ?? "" }
    static var startsAtStepTwo: Bool { mode == "step2" }
    static var opensAdjustSheet: Bool { mode == "b2-adjust" }

    static let client = NativeBridgeClient { name, _ in
        switch name {
        case "native/reconcile-month": month
        case "account-statement-balance-prefill": prefill
        case "native/reconcile-rows": rows
        case "native/reconcile-tick": #"{"statement":465413,"cleared":465413,"difference":0}"#
        case "native/reconcile-matches":
            #"{"difference":4180,"matches":[{"kind":"tick-one","ids":["t4"],"amounts":[4180]},{"kind":"tick-two","ids":["t2","t5"],"amounts":[-3820,8000]}],"add_amount_param":"-41.80"}"#
        case "native/reconcile-lock-preview": preview
        case "native/reconcile-lock":
            mode == "b2-moved"
                ? #"{"locked_ids":["t1"],"linked_ids":[],"verified":false,"cleared":464413,"difference":1000}"#
                : #"{"locked_ids":["t1"],"linked_ids":["x1","x2"],"verified":true,"cleared":465413,"difference":0}"#
        default: "null"
        }
    }

    private static let style = #""currencyCode":"USD","currencyDecimalPlaces":2,"currencySymbol":"$","currencySymbolPosition":"before","currencySpace":false,"numberFormat":"comma-dot","hideFraction":false"#

    private static func account(_ id: String, _ name: String, _ status: String, _ cleared: Int, _ statement: String = "null", _ reconciled: String = "null") -> String {
        let source = id == "checking" ? #""simpleFin""# : "null"
        return #"{"id":"\#(id)","name":"\#(name)","status":"\#(status)","detail":{"cleared":\#(cleared),"statement":\#(statement)},"last_reconciled":\#(reconciled),"sync_source":\#(source)}"#
    }

    private static let month = "{\(style),\"month\":\"2026-11\",\"excluded\":[],\"hidden\":[],\"accounts\":[" + [
        account("checking", "Joint Checking", "in-progress", 461233, "465413"),
        account("visa", "Visa Signature", "due", -128840),
        account("savings", "High-Yield Savings", "due", 841000),
        account("paycheck", "Acme Paycheck", "done", 0, "null", "\"1794200000000\""),
        account("mortgage", "Mortgage", "done", -21450000, "null", "\"1794100000000\""),
    ].joined(separator: ",") + "]}"

    private static let prefill =
        #"{"prefill":{"amount":465413,"source":"bank-sync","as_of":"2026-11-17","link":"bank-sync"},"alternatives":[{"amount":461233,"source":"cleared","as_of":null,"link":null}],"cleared_balance":461233,"record":null,"account_type":null}"#

    private static let preview =
        #"{"rows":[],"count":17,"child_count":2,"truncated":false,"partners":[{"id":"x1","account":"High-Yield Savings","amount":-50000,"date":"2026-11-03","reconciled":false},{"id":"x2","account":"Visa Signature","amount":30000,"date":"2026-11-20","reconciled":false}],"skipped_children":[],"record":{"amount":465413,"source":"bank-sync","entered_at":1794935880000},"plan_digest":"demo"}"#

    private static func row(_ id: String, _ payee: String, _ category: String, _ date: String, _ amount: Int, _ cleared: Bool) -> String {
        #"{"id":"\#(id)","date":"\#(date)","payee":"\#(payee)","category":"\#(category)","notes":null,"amount":\#(amount),"cleared":\#(cleared),"reconciled":false,"isParent":false}"#
    }

    private static let rows = #"{"account":"checking","scope":"to-tick","rows":["# + [
        row("t1", "Trader Joe’s", "Groceries", "2026-11-14", -4218, true),
        row("t2", "Shell", "Gas", "2026-11-14", -3820, false),
        row("t3", "Netflix", "Subscriptions", "2026-11-09", -1549, false),
        row("t4", "Costco refund", "Groceries", "2026-11-08", 4180, false),
    ].joined(separator: ",") + #"],"summary":{"statement":465413,"cleared":461233,"difference":4180}}"#
}
#endif
