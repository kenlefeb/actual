import SwiftUI

// Fork-only (sc-4801, native-reconcile-flow D7; sc-3611). The shared
// Transaction row of the Figma "Accounts page" component: payee, category (and
// date in Reconcile), the amount, and a status word with its symbol (never
// colour alone). Built for Reconcile step 2; the native register reuses it with
// the `.register` style. It shows what it is given and works nothing out.
struct NativeTransactionRow: View {
    enum Status: Equatable { case cleared, notCleared, locked, scheduled }
    // Reconcile: "category · date" and "Not cleared". Register: the date is the
    // section's, an unset category reads "Uncategorized" in warning text and
    // not cleared reads "Pending".
    enum Style: Equatable { case reconcile, register }

    let payee: String
    let category: String?
    let date: String
    let amount: String
    let isIncome: Bool
    let status: Status
    var style: Style = .reconcile

    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        content
            .padding(.vertical, 6)
        .opacity(status == .locked && style == .reconcile ? 0.55 : 1)
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

    private var isScheduled: Bool { status == .scheduled }
    private var isUncategorizedWarning: Bool { style == .register && category == nil && !isScheduled }

    private var names: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(payee).font(.body).foregroundColor(isScheduled ? .secondary : .primary)
            Text(detail).font(.subheadline).foregroundColor(isUncategorizedWarning ? Money.warning : .secondary)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private func amountAndStatus(alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 2) {
            Text(amount)
                .font(.body.monospacedDigit())
                .foregroundColor(isScheduled ? .secondary : isIncome ? NativeReconcileTokens.positive : .primary)
                // Beside the payee it keeps its width, so the payee wraps, not the number
                .fixedSize(horizontal: !typeSize.isAccessibilitySize, vertical: true)
            statusLabel
        }
    }

    private var detail: String {
        switch style {
        case .reconcile: [category ?? NativeTransactionRowWords.uncategorized, Dates.short(date)].joined(separator: " · ")
        case .register: isScheduled ? [category, Dates.monthDay(date)].compactMap { $0 }.joined(separator: " · ")
            : category ?? NativeTransactionRowWords.uncategorized
        }
    }

    private var word: String {
        switch status {
        case .cleared: NativeTransactionRowWords.cleared
        case .notCleared: style == .register ? NativeTransactionRowWords.pending : NativeTransactionRowWords.notCleared
        case .locked: NativeTransactionRowWords.locked
        case .scheduled: NativeTransactionRowWords.scheduled
        }
    }

    @ViewBuilder private var statusLabel: some View {
        let (symbol, tint): (String?, Color) =
            switch status {
            case .cleared: ("checkmark.circle.fill", NativeReconcileTokens.accent)
            case .notCleared: (style == .register ? nil : "circle", .secondary)
            case .locked: ("lock.fill", .secondary)
            case .scheduled: (nil, .secondary)
            }
        HStack(spacing: 4) {
            if let symbol { Image(systemName: symbol).imageScale(.small) }
            Text(word)
        }
        .font(.footnote)
        .foregroundColor(tint)
    }

    private var accessibilityText: String {
        let parts: [String] =
            switch style {
            case .reconcile: [payee, category ?? NativeTransactionRowWords.uncategorized, amount, Dates.short(date), word]
            case .register: [payee, detail, amount, word]
            }
        return parts.filter { !$0.isEmpty }.joined(separator: ", ")
    }
}

enum NativeTransactionRowWords {
    static let cleared = NSLocalizedString("Cleared", comment: "Native transaction row: cleared status")
    static let notCleared = NSLocalizedString("Not cleared", comment: "Native transaction row: not cleared status")
    static let pending = NSLocalizedString("Pending", comment: "Native transaction row: not cleared, in the register")
    static let scheduled = NSLocalizedString("Scheduled", comment: "Native transaction row: an upcoming scheduled transaction")
    static let locked = NSLocalizedString("Reconciled", comment: "Native transaction row: reconciled and locked")
    static let uncategorized = NSLocalizedString("Uncategorized", comment: "Native transaction row: no category")
}
