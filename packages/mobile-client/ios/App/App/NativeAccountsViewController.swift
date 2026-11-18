import Combine
import SwiftUI
import UIKit

// Fork-only (sc-4931, native-accounts-screen D4 to D7a). The native Accounts
// screen's host: NativeTabBarController lays it over the web Accounts screens
// while the (off by default) switch is on and the page shows `/accounts` or
// `/accounts/<id>` with the tab bar. It stays hidden, so the web screen shows,
// until loot-core has answered and knows the account; a failed read leaves the
// web screen too. Story 3611 puts the SwiftUI list and register inside; until
// then it shows a plain notice. Nothing in Settings turns the switch on until then; developers set
// the UserDefaults key `NativeScreen.accounts` (NativeScreenSwitch.accountsKey) to true.
final class NativeAccountsViewController: UIHostingController<AccountsNotice> {
    let route: NativeAccountsRoute
    private let model: AccountsListViewModel
    private let chrome: NativeChromePlugin
    private var lifecycleObservers: [NSObjectProtocol] = []
    private var stateObserver: AnyCancellable?

    init(client: NativeBridgeClient, route: NativeAccountsRoute, chrome: NativeChromePlugin) {
        self.route = route
        self.chrome = chrome
        model = AccountsListViewModel(client: client)
        super.init(rootView: AccountsNotice())
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    // A page event (NativeBridgePlugin.onPaychecksEvent): "ready" is the page back after a refused call
    func eventReceived(_ event: String, tables: [String]) {
        if event == "ready" {
            Task { await model.pageReady() }
        } else {
            model.eventReceived(event, tables: tables)
        }
    }

    // The closed set of web flows (D7a); an action or account it does not allow is dropped
    func handOff(_ action: String, accountId: String? = nil) {
        guard let list = model.state.value,
              let hand = try? WebAccountAction(action, accountId: accountId, openAccountIds: NativeAccountsRoute.openAccountIds(in: list))
        else { return }
        chrome.handOff(hand)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemGroupedBackground
        view.accessibilityViewIsModal = true
        // The web screen shows until the list is read and the account is known
        view.isHidden = true
        stateObserver = model.$state.sink { [weak self] state in
            guard let self else { return }
            if let list = state.value { self.view.isHidden = !self.route.isKnown(in: list) } else { self.view.isHidden = true }
        }
        let center = NotificationCenter.default
        for (name, active) in [(UIApplication.didBecomeActiveNotification, true), (UIApplication.willResignActiveNotification, false)] {
            lifecycleObservers.append(
                center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                    guard let model = self?.model else { return }
                    Task { await model.setSceneActive(active) }
                })
        }
        Task { await model.load() }
    }

    deinit { lifecycleObservers.forEach(NotificationCenter.default.removeObserver) }
}

struct AccountsNotice: View {
    var body: some View {
        VStack(spacing: 12) {
            Text("Accounts")
                .font(.largeTitle.bold())
            Text("The native Accounts screen is still being built.")
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}
