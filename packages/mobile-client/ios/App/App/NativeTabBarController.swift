import UIKit

// Fork-only (sc-3514, ADR 11). The iPhone app's root: a system tab bar with
// Budget, Accounts, Reports and Settings, plus a separate Add button. There is
// one AppBridgeViewController, so one WKWebView and one loot-core; it moves
// into whichever web tab is showing. A tab can host a native screen instead
// (none ships yet; DEBUG builds can mark one with a stub, see below).
final class NativeTabBarController: UITabBarController, UITabBarControllerDelegate {
    let bridgeController = AppBridgeViewController()
    private var router = NativeTabRouter()
    private var containers: [NativeTab: TabContainerViewController] = [:]
    private var foregroundObserver: NSObjectProtocol?
    // The native Budget tab (sc-3751) lies over the web Budget screen while the
    // switch is on, the page shows /budget with the tab bar, and the budget is
    // an envelope one; otherwise the web screen below shows as before
    private var budgetOverlay: NativeBudgetViewController?
    private var budgetFellBack = false
    private var pagePath = NativeTab.budget.rootPath
    private var tabBarShown = false
    private static let addIdentifier = "add"

    // Hearth Teal, DESIGN.native.md §3
    static let accent = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0x4F / 255, green: 0xD1 / 255, blue: 0xC5 / 255, alpha: 1)
            : UIColor(red: 0x0E / 255, green: 0x7C / 255, blue: 0x74 / 255, alpha: 1)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        delegate = self
        tabBar.tintColor = Self.accent

        for tab in NativeTab.allCases {
            let container = TabContainerViewController(tab: tab)
            container.onWillAppear = { [weak self] in self?.tabWillAppear($0) }
            if let screen = Self.nativeScreen(for: tab) { container.embed(screen) }
            containers[tab] = container
        }

        if #available(iOS 18, *) {
            let sections = NativeTab.allCases.map { tab in
                UITab(title: tab.title, image: UIImage(systemName: tab.symbol), identifier: tab.rawValue) { [unowned self] _ in
                    containers[tab]!
                }
            }
            // A plain tab pinned to the trailing end. On iOS 27 it sits inside
            // the glass bar either way; a UISearchTab drew no differently and
            // carried search semantics. Selecting it is intercepted below.
            let add = UITab(title: NSLocalizedString("Add", comment: "Tab bar: add a transaction"),
                            image: UIImage(systemName: "plus"), identifier: Self.addIdentifier) { _ in UIViewController() }
            add.preferredPlacement = .pinned
            tabs = sections + [add]
        } else {
            let add = UIViewController()
            add.tabBarItem = UITabBarItem(title: NSLocalizedString("Add", comment: "Tab bar: add a transaction"),
                                          image: UIImage(systemName: "plus.circle"), tag: 0)
            add.tabBarItem.accessibilityIdentifier = Self.addIdentifier
            viewControllers = NativeTab.allCases.map { containers[$0]! } + [add]
        }

        let chrome = bridgeController.nativeChrome
        chrome.onRoute = { [weak self] in self?.pageDidRoute(to: $0, tabBar: $1) }
        chrome.onClosed = { [weak self] in
            self?.budgetFellBack = false
            self?.setTabBarVisible(false)
        }
        chrome.onNativeScreenChanged = { [weak self] _ in
            self?.budgetFellBack = false
            self?.updateBudgetOverlay()
        }
        // Hidden until a budget is open (sign-in and the budget list have none)
        setTabBarVisible(false)

        foregroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in self?.bridgeController.nativeChrome.reportRoute() }
    }

    // MARK: Tabs

    private func tabWillAppear(_ tab: NativeTab) {
        let container = containers[tab]!
        if tab == .budget { budgetOverlay?.reload() }
        guard !container.hostsNativeScreen else {
            _ = router.select(tab)
            return
        }
        container.host(bridgeController)
        // A tab the page already moved to (pageDidRoute) needs no navigation
        guard router.selected != tab else { return }
        bridgeController.nativeChrome.navigate(to: router.select(tab))
    }

    // The page decides when the bar hides: on a pushed form (new or edit
    // transaction) and while a sheet shows, as iOS apps do
    private func pageDidRoute(to path: String, tabBar: Bool) {
        pagePath = path
        setTabBarVisible(tabBar)
        guard let tab = router.pageDidRoute(to: path) else { return }
        show(tab)
    }

    private func openAdd() {
        // shortcut: from a native tab, Add opens in the Budget tab; a native
        // Add sheet replaces this when that screen ships
        if containers[router.selected]!.hostsNativeScreen { show(.budget) }
        bridgeController.nativeChrome.navigate(to: NativeTabRouter.addPath)
    }

    private func show(_ tab: NativeTab) {
        if #available(iOS 18, *) {
            selectedTab = tabs.first { $0.identifier == tab.rawValue }
        } else {
            selectedViewController = containers[tab]
        }
    }

    private func setTabBarVisible(_ visible: Bool) {
        if #available(iOS 18, *) {
            setTabBarHidden(!visible, animated: false)
        } else {
            tabBar.isHidden = !visible
        }
        containers.values.forEach { $0.tabBarVisible = visible }
        tabBarShown = visible
        updateBudgetOverlay()
    }

    private func updateBudgetOverlay() {
        let container = containers[.budget]!
        let wanted = NativeScreenSwitch.screen(for: .budget) == .native && tabBarShown
            && pagePath == NativeTab.budget.rootPath && !budgetFellBack && !container.hostsNativeScreen
        if wanted, budgetOverlay == nil {
            let overlay = NativeBudgetViewController(client: bridgeController.nativeBridge.client)
            overlay.onUseWebScreen = { [weak self] in
                // After the publisher callback returns: the overlay removes itself
                DispatchQueue.main.async {
                    self?.budgetFellBack = true
                    self?.updateBudgetOverlay()
                }
            }
            budgetOverlay = overlay
            // shortcut: onEvent is a single slot; the benchmark harness also sets it, and only runs in its own build
            // "ready": the app's own page is back after a refused call (sc-3859). One
            // posted before this overlay existed is covered by the overlay's first load.
            bridgeController.nativeBridge.onEvent = { [weak overlay] event in
                if event == "ready" { overlay?.pageReady() } else { overlay?.changeEventReceived() }
            }
            container.setOverlay(overlay)
        } else if !wanted, budgetOverlay != nil {
            budgetOverlay = nil
            bridgeController.nativeBridge.onEvent = nil
            container.setOverlay(nil)
        }
    }

    // MARK: UITabBarControllerDelegate (the Add button never becomes selected)

    @available(iOS 18, *)
    func tabBarController(_ tabBarController: UITabBarController, shouldSelectTab tab: UITab) -> Bool {
        if tab.identifier == Self.addIdentifier {
            openAdd()
            return false
        }
        if tab === selectedTab { popToRoot() }
        return true
    }

    func tabBarController(_ tabBarController: UITabBarController, shouldSelect viewController: UIViewController) -> Bool {
        if viewController.tabBarItem.accessibilityIdentifier == Self.addIdentifier {
            openAdd()
            return false
        }
        if viewController === selectedViewController { popToRoot() }
        return true
    }

    // Tapping the selected tab again returns to its section's first screen,
    // as in other iOS apps (and reaches Settings again from Schedules)
    private func popToRoot() {
        guard !containers[router.selected]!.hostsNativeScreen else { return }
        bridgeController.nativeChrome.navigate(to: router.selected.rootPath)
    }

    // MARK: Native screens

    // A tab that is native for good (none ships; the Budget tab of sc-3593 is an
    // overlay, see updateBudgetOverlay). DEBUG builds can mark a tab native
    // with a launch argument, e.g. `-NativeTabStub reports`, to check that the
    // bar does not change and the web view stays single.
    private static func nativeScreen(for tab: NativeTab) -> UIViewController? {
        #if DEBUG
        if UserDefaults.standard.string(forKey: "NativeTabStub") == tab.rawValue {
            return StubNativeViewController(tab: tab)
        }
        #endif
        return nil
    }
}

extension NativeTab {
    var title: String {
        switch self {
        case .budget: NSLocalizedString("Budget", comment: "Tab bar")
        case .accounts: NSLocalizedString("Accounts", comment: "Tab bar")
        case .reports: NSLocalizedString("Reports", comment: "Tab bar")
        case .settings: NSLocalizedString("Settings", comment: "Tab bar")
        }
    }

    var symbol: String {
        switch self {
        case .budget: "chart.pie"
        case .accounts: "building.columns"
        case .reports: "chart.bar"
        case .settings: "gearshape"
        }
    }
}

// One tab's screen: the shared web view while this tab shows it, or a native
// screen for good
final class TabContainerViewController: UIViewController {
    let section: NativeTab
    var onWillAppear: ((NativeTab) -> Void)?
    private(set) var hostsNativeScreen = false
    private var overlay: UIViewController?
    private var bottomToSafeArea: NSLayoutConstraint?
    private var bottomToEdge: NSLayoutConstraint?

    // The web view ends above the tab bar; with no tab bar (no budget open) it
    // runs to the bottom edge, as it did before the tab bar
    var tabBarVisible = false {
        didSet { updateBottom() }
    }

    init(tab: NativeTab) {
        self.section = tab
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        onWillAppear?(section)
    }

    // The status bar follows the screen in this tab
    override var childForStatusBarStyle: UIViewController? { children.first }
    override var childForStatusBarHidden: UIViewController? { children.first }

    func embed(_ screen: UIViewController) {
        hostsNativeScreen = true
        attach(screen)
    }

    // Moves the one bridge view controller (and its web view) into this tab.
    // It is never copied: there is only ever one web view and one engine.
    func host(_ bridge: UIViewController) {
        guard bridge.parent !== self else { return }
        if let previous = bridge.parent as? TabContainerViewController {
            bridge.willMove(toParent: nil)
            bridge.view.removeFromSuperview()
            bridge.removeFromParent()
            // Its constraints went with the view; never reactivate them
            previous.bottomToSafeArea = nil
            previous.bottomToEdge = nil
        }
        attach(bridge)
    }

    // A native screen lying over the hosted web view (sc-3751); nil removes it.
    // It is only ever shown with the tab bar, so it ends above the bar.
    func setOverlay(_ screen: UIViewController?) {
        if let old = overlay {
            old.willMove(toParent: nil)
            old.view.removeFromSuperview()
            old.removeFromParent()
        }
        overlay = screen
        guard let screen else { return }
        addChild(screen)
        screen.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(screen.view)
        NSLayoutConstraint.activate([
            screen.view.topAnchor.constraint(equalTo: view.topAnchor),
            screen.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            screen.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            screen.view.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
        ])
        screen.didMove(toParent: self)
    }

    private func attach(_ child: UIViewController) {
        addChild(child)
        child.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(child.view)
        bottomToSafeArea = child.view.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor)
        bottomToEdge = child.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        NSLayoutConstraint.activate([
            child.view.topAnchor.constraint(equalTo: view.topAnchor),
            child.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            child.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        updateBottom()
        if let overlay { view.bringSubviewToFront(overlay.view) }
        child.didMove(toParent: self)
        setNeedsStatusBarAppearanceUpdate()
    }

    private func updateBottom() {
        bottomToEdge?.isActive = !tabBarVisible
        bottomToSafeArea?.isActive = tabBarVisible
    }
}

#if DEBUG
// Test-only stand-in for a native screen (sc-3514); never in a Release build
final class StubNativeViewController: UIViewController {
    private let section: NativeTab

    init(tab: NativeTab) {
        self.section = tab
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemGroupedBackground
        let label = UILabel()
        label.text = "Native \(section.title) (test stub)"
        label.font = .preferredFont(forTextStyle: .title2)
        label.adjustsFontForContentSizeCategory = true
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])
    }
}
#endif
