import Foundation

// Fork-only (sc-3611, native-accounts-screen D7). What the native Accounts list
// shows besides loot-core's numbers: each row's detail line, the sync status
// under the title, and where an Edit-mode drop moves an account. Free of
// UIKit, so the Mac app reuses it.

extension AccountsList {
    public var amountStyle: BudgetAmountStyle {
        BudgetAmountStyle(
            currencyCode: currencyCode, currencySymbol: currencySymbol, decimalPlaces: currencyDecimalPlaces,
            symbolPosition: currencySymbolPosition, symbolSpace: currencySpace, numberFormat: numberFormat,
            hideFraction: hideFraction)
    }

    public var isEmpty: Bool { sections.onBudget.accounts.isEmpty && sections.offBudget.accounts.isEmpty && closed.accounts.isEmpty }

    // Shown at once after a drop, while the write and the re-read run; the
    // re-read replaces it. Only within one section; totals are untouched.
    public func moving(_ id: String, before targetId: String?) -> AccountsList {
        func moved(_ section: Section) -> Section? {
            guard let from = section.accounts.firstIndex(where: { $0.id == id }) else { return nil }
            var accounts = section.accounts
            let account = accounts.remove(at: from)
            if let targetId {
                guard let to = accounts.firstIndex(where: { $0.id == targetId }) else { return nil }
                accounts.insert(account, at: to)
            } else {
                accounts.append(account)
            }
            return Section(total: section.total, accounts: accounts)
        }
        if let on = moved(sections.onBudget) { return with(Sections(onBudget: on, offBudget: sections.offBudget)) }
        if let off = moved(sections.offBudget) { return with(Sections(onBudget: sections.onBudget, offBudget: off)) }
        return self
    }

    private func with(_ sections: Sections) -> AccountsList {
        AccountsList(
            currencyCode: currencyCode, currencyDecimalPlaces: currencyDecimalPlaces, currencySymbol: currencySymbol,
            currencySymbolPosition: currencySymbolPosition, currencySpace: currencySpace, numberFormat: numberFormat,
            hideFraction: hideFraction, sections: sections, closed: closed, netWorth: netWorth)
    }
}

public enum AccountsListSection: Equatable { case onBudget, offBudget }

extension AccountsList {
    public func accounts(in section: AccountsListSection) -> [Account] {
        section == .onBudget ? sections.onBudget.accounts : sections.offBudget.accounts
    }
}

// A row's line under its name (D7): the paycheck it clears for, else when the
// bank last synced it, else its latest transaction's date
public enum AccountDetail: Equatable {
    case clearing(paycheck: String)
    case synced(Date)
    // yyyy-MM-dd
    case updated(String)
    case closed(offBudget: Bool)
    case none

    public init(_ account: AccountsList.Account) {
        if account.closed {
            self = .closed(offBudget: account.offbudget)
        } else if let paycheck = account.clearingFor {
            self = .clearing(paycheck: paycheck)
        } else if let ms = account.lastSync.flatMap(Double.init) {
            self = .synced(Date(timeIntervalSince1970: ms / 1000))
        } else if let day = account.lastTransactionDate {
            self = .updated(day)
        } else {
            self = .none
        }
    }
}

// The budget's sync state for the list's subtitle (mobile-sync-status): from
// loot-core's sync events and the list's own pull. A failure stays until a
// later sync outcome replaces it.
public enum NativeSyncStatus: Equatable {
    case unknown, syncing, synced(Date), offline, failed
    // No server, or syncing is off
    case local

    // A page event's body ({event, payload}); anything but a sync outcome keeps the status
    public func next(after body: Any, now: Date) -> NativeSyncStatus {
        guard NativeBridgeEvent.name(of: body) == "sync-event",
            let payload = (body as? [String: Any])?["payload"] as? [String: Any]
        else { return self }
        switch payload["type"] as? String {
        case "start": return .syncing
        case "success": return payload["syncDisabled"] as? Bool == true ? .local : .synced(now)
        case "error": return payload["subtype"] as? String == "network" ? .offline : .failed
        case "unauthorized": return .failed
        default: return self
        }
    }

    // nil: the pull's sync worked. A pull that timed out is still running.
    public func after(pull failure: BudgetRefreshError?, now: Date) -> NativeSyncStatus {
        switch failure {
        case nil, .refreshFailed: return .synced(now)
        case .offline: return .offline
        case .signedOut, .failed: return .failed
        case .timedOut: return .syncing
        }
    }
}

extension AccountMove {
    public enum Target: Equatable {
        case before(String)
        case end
    }

    // SwiftUI's onMove: `to` is an index in the list before the row is taken
    // out. nil when the drop leaves the row where it was.
    public static func target(in ids: [String], from: Int, to: Int) -> Target? {
        guard ids.indices.contains(from), to >= 0, to <= ids.count, to != from, to != from + 1 else { return nil }
        return to < ids.count ? .before(ids[to]) : .end
    }
}
