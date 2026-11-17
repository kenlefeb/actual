import SwiftUI

// Fork-only (sc-4801, native-reconcile-flow D7). The shared Transaction row of
// the Figma "Accounts page" component: payee, category and date, the amount,
// and a cleared status word with its symbol (never colour alone). Built for
// Reconcile step 2; the native Accounts screen reuses it. It shows what it is
// given and works nothing out.
struct NativeTransactionRow: View {
    enum Status: Equatable { case cleared, notCleared, locked }

    let payee: String
    let category: String?
    let date: String
    let amount: String
    let isIncome: Bool
    let status: Status

    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        content
            .padding(.vertical, 6)
        .opacity(status == .locked ? 0.55 : 1)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(accessibilityText))
    }

    // At accessibility sizes the amount moves under the payee, whole
    @ViewBuilder private var content: some View {
        if typeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 4) {
                names
                amountAndStatus(alignment: .leading)
            }
        } else {
            HStack(alignment: .top) {
                names
                Spacer(minLength: 8)
                amountAndStatus(alignment: .trailing)
            }
        }
    }

    private var names: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(payee).font(.body)
            Text(detail).font(.subheadline).foregroundColor(.secondary)
        }
    }

    private func amountAndStatus(alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 2) {
            Text(amount)
                .font(.body.monospacedDigit())
                .foregroundColor(isIncome ? NativeReconcileTokens.positive : .primary)
                .fixedSize(horizontal: false, vertical: true)
            statusLabel
        }
    }

    private var detail: String {
        [category ?? NativeTransactionRowWords.uncategorized, Dates.short(date)].joined(separator: " · ")
    }

    @ViewBuilder private var statusLabel: some View {
        let (word, symbol, tint): (String, String, Color) =
            switch status {
            case .cleared: (NativeTransactionRowWords.cleared, "checkmark.circle.fill", NativeReconcileTokens.accent)
            case .notCleared: (NativeTransactionRowWords.notCleared, "circle", .secondary)
            case .locked: (NativeTransactionRowWords.locked, "lock.fill", .secondary)
            }
        HStack(spacing: 4) {
            Image(systemName: symbol).imageScale(.small)
            Text(word)
        }
        .font(.footnote)
        .foregroundColor(tint)
    }

    private var accessibilityText: String {
        let state =
            switch status {
            case .cleared: NativeTransactionRowWords.cleared
            case .notCleared: NativeTransactionRowWords.notCleared
            case .locked: NativeTransactionRowWords.locked
            }
        return [payee, category ?? NativeTransactionRowWords.uncategorized, amount, Dates.short(date), state].joined(separator: ", ")
    }
}

enum NativeTransactionRowWords {
    static let cleared = NSLocalizedString("Cleared", comment: "Native transaction row: cleared status")
    static let notCleared = NSLocalizedString("Not cleared", comment: "Native transaction row: not cleared status")
    static let locked = NSLocalizedString("Reconciled", comment: "Native transaction row: reconciled and locked")
    static let uncategorized = NSLocalizedString("Uncategorized", comment: "Native transaction row: no category")
}
