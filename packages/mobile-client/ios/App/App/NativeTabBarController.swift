import Combine
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
    private var pageNoticeWindow: PageNoticeWindow?
    private var noticeHeight: CGFloat = 0
    private var noticeFollower: Timer?
    // sc-5219: "Saving…" and "Still saving to this device. Keep the app open.", above the tab bar
    private var writeStorageLine: WriteStorageLine?
    // The native Budget tab (sc-3751) lies over the web Budget screen while the
    // switch is on and the page shows /budget with the tab bar; otherwise the web screen below shows as before
    private var budgetOverlay: NativeBudgetViewController?
    // The native Schedules & Paychecks list (sc-4341) lies over the web
    // Schedules screen the same way, in whichever tab shows it
    private var paychecksOverlay: (screen: NativePaychecksViewController, container: TabContainerViewController)?
    // The native Accounts screen (sc-4931) lies over the web Accounts screens while
    // its off-by-default switch is on and the page shows /accounts or /accounts/<id>
    private var accountsOverlay: NativeAccountsViewController?
    // The native Reconcile flow (sc-4801), presented over whichever tab asked
    private weak var reconcileFlow: NativeReconcileViewController?
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
            self?.setTabBarVisible(false)
        }
        chrome.onNativeScreenChanged = { [weak self] in
            self?.updateOverlays()
            self?.budgetOverlay?.syncPaychecksSwitch()
        }
        // The list's overlay and the Budget tab's paycheck row both follow the page's events
        bridgeController.nativeBridge.onPaychecksEvent = { [weak self] event, tables in
            self?.budgetOverlay?.paychecksEventReceived(event, tables: tables)
            self?.paychecksOverlay?.screen.eventReceived(event, tables: tables)
            self?.accountsOverlay?.eventReceived(event, tables: tables)
            self?.reconcileFlow?.eventReceived(event, tables: tables)
        }
        bridgeController.nativeBridge.onSyncStatus = { [weak self] in self?.accountsOverlay?.syncStatusChanged($0) }
        chrome.onPresentReconcile = { [weak self] body in self?.presentReconcile(body) }
        // Hidden until a budget is open (sign-in and the budget list have none)
        setTabBarVisible(false)

        foregroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in self?.bridgeController.nativeChrome.reportRoute() }
    }

    // sc-5220: the window exists from here on
    override func viewIsAppearing(_ animated: Bool) {
        super.viewIsAppearing(animated)
        guard pageNoticeWindow == nil, let window = view.window, let scene = window.windowScene else { return }
        pageNoticeWindow = PageNoticeWindow(
            notices: bridgeController.pageNotices, scene: scene, mainWindow: window,
            reserve: { [weak self] in self?.reserveNoticeSpace($0) })
    }

    // Everything below the strip starts under it, sheets included
    private func reserveNoticeSpace(_ height: CGFloat) {
        noticeHeight = height
        additionalSafeAreaInsets.top = height
        giveSheetsNoticeSpace()
        // The storage line's window (sc-5219) ends below the strip too, so the
        // two never overlap, however large the text
        view.window?.windowScene?.windows.filter { $0.windowLevel == .alert }
            .forEach { $0.rootViewController?.additionalSafeAreaInsets.top = height }
        // As the storage line does: UIKit says nothing when a sheet opens, so
        // while the strip is up a sheet opened under it is found by looking
        noticeFollower?.invalidate()
        noticeFollower = height > 0
            ? Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.giveSheetsNoticeSpace() }
            }
            : nil
        // A list under a large title keeps its old inset until its navigation
        // view is laid out again, which would leave a gap when the strip goes
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            guard let self else { return }
            Self.navigationControllers(in: self).forEach {
                $0.view.setNeedsLayout()
                $0.view.layoutIfNeeded()
            }
        }
    }

    private func giveSheetsNoticeSpace() {
        var presented = presentedViewController
        while let screen = presented {
            if screen.additionalSafeAreaInsets.top != noticeHeight { screen.additionalSafeAreaInsets.top = noticeHeight }
            presented = screen.presentedViewController
        }
    }

    private static func navigationControllers(in controller: UIViewController) -> [UINavigationController] {
        controller.children.flatMap { navigationControllers(in: $0) } + [controller as? UINavigationController].compactMap { $0 }
    }

    private func attachWriteStorageLine() {
        guard WriteStorageLineRollout.isOn, writeStorageLine == nil, let scene = view.window?.windowScene else { return }
        #if DEBUG
        UITestAccounts.holdStorageLine(bridgeController.nativeBridge.writeStorage)
        #endif
        writeStorageLine = WriteStorageLine(
            status: bridgeController.nativeBridge.writeStorage, scene: scene,
            barHeight: { [weak self] in
                guard let self, self.tabBarShown else { return 0 }
                // A context menu is presented too, but only a sheet covers the tab bar
                let coversTabBar = self.presentedViewController?.sheetPresentationController != nil
                return coversTabBar ? 0 : self.view.bounds.maxY - self.tabBar.frame.minY
            },
            reserve: { [weak self] height, keyboard in
                guard let self else { return }
                self.containers.values.forEach { $0.reserveBottom(height) }
                var presented = self.presentedViewController
                while let screen = presented {
                    // A sheet's own keyboard room would otherwise swallow the line's
                    screen.additionalSafeAreaInsets.bottom = height + keyboard
                    presented = screen.presentedViewController
                }
            })
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
        let tab = router.pageDidRoute(to: path)
        setTabBarVisible(tabBar)
        guard let tab else { return }
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
        updateOverlays()
    }

    private func updateOverlays() {
        updateBudgetOverlay()
        updatePaychecksOverlay()
        updateAccountsOverlay()
    }

    // sc-4931, sc-3611 (D5): the route decides. One screen serves the list and the
    // registers, so a register pushes over the list. It steps aside, keeping its
    // place, while the web shows (a sheet, the editor, another path) and re-reads
    // when the page comes back; it goes only when the switch is off.
    private func updateAccountsOverlay() {
        let container = containers[.accounts]!
        let switchOn = NativeScreenSwitch.isAccountsNative()
        guard switchOn, !container.hostsNativeScreen else {
            if accountsOverlay != nil {
                accountsOverlay = nil
                container.setOverlay(nil)
            }
            return
        }
        let route = NativeAccountsRoute.wanted(switchOn: switchOn, tabBarShown: tabBarShown, path: pagePath, selected: router.selected)
        if accountsOverlay == nil {
            guard route != nil else { return }
            let chrome = bridgeController.nativeChrome
            let screen = NativeAccountsViewController(
                client: bridgeController.nativeBridge.client, chrome: chrome, syncStatus: bridgeController.nativeBridge.syncStatus,
                presentReconcile: { [weak self] in self?.presentReconcile($0) })
            accountsOverlay = screen
            container.setOverlay(screen)
        }
        accountsOverlay?.show(route)
    }

    private func updatePaychecksOverlay() {
        let container = containers[router.selected]!
        let wanted = NativeScreenSwitch.isPaychecksNative() && tabBarShown && pagePath == "/schedules"
            && !container.hostsNativeScreen
        if let current = paychecksOverlay, !wanted || current.container !== container {
            paychecksOverlay = nil
            current.container.setCover(nil)
        }
        guard wanted, paychecksOverlay == nil else { return }
        let chrome = bridgeController.nativeChrome
        let screen = NativePaychecksViewController(
            client: bridgeController.nativeBridge.client, backPath: router.selected.rootPath,
            navigate: { [weak chrome] in chrome?.navigate(to: $0) })
        paychecksOverlay = (screen, container)
        // A cover, so a native Budget tab below it keeps its month and scroll position (sc-4309)
        container.setCover(screen)
    }

    private func updateBudgetOverlay() {
        let container = containers[.budget]!
        // Kept while the paychecks list covers it (opened from its row), so back finds the same month and scroll
        let wanted = NativeScreenSwitch.keepsBudgetOverlay(
            budgetNative: NativeScreenSwitch.screen(for: .budget) == .native, tabBarShown: tabBarShown, path: pagePath,
            selected: router.selected, paychecksNative: NativeScreenSwitch.isPaychecksNative()) && !container.hostsNativeScreen
        if wanted, budgetOverlay == nil {
            let chrome = bridgeController.nativeChrome
            let overlay = NativeBudgetViewController(
                client: bridgeController.nativeBridge.client, openPaychecks: { [weak chrome] in chrome?.navigate(to: "/schedules") })
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

    // sc-4801: reads the checklist first, so only an open account it lists
    // (or the banner's checklist request) opens the flow; anything else is ignored
    private func presentReconcile(_ body: Any) {
        guard reconcileFlow == nil, presentedViewController == nil else { return }
        let client = bridgeController.nativeBridge.client
        let month = ReconcileMonthViewModel(client: client)
        Task { @MainActor [weak self] in
            await month.load()
            guard let self, self.reconcileFlow == nil, self.presentedViewController == nil,
                  let request = month.request(from: body), month.state.read != nil
            else { return }
            let chrome = self.bridgeController.nativeChrome
            let flow = NativeReconcileViewController(
                month: month, request: request, client: client, navigate: { [weak chrome] in chrome?.navigate(to: $0) })
            self.reconcileFlow = flow
            self.present(flow, animated: true)
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        attachWriteStorageLine()
        #if DEBUG
        showReconcileDemo()
        #endif
    }

    #if DEBUG
    // Test-only: `-ReconcileDemo checklist|step1|step2` shows the flow on sample data
    private func showReconcileDemo() {
        guard let request = ReconcileDemo.request, reconcileFlow == nil else { return }
        let month = ReconcileMonthViewModel(client: ReconcileDemo.client)
        Task { @MainActor in
            await month.load()
            let flow = NativeReconcileViewController(month: month, request: request, client: ReconcileDemo.client, navigate: { _ in })
            if ReconcileDemo.startsAtStepTwo { flow.showStepTwo("checking") }
            if ReconcileDemo.mode.hasPrefix("b2-") { flow.showDemo(ReconcileDemo.mode, "checking") }
            reconcileFlow = flow
            present(flow, animated: false)
        }
    }
    #endif

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

// sc-5219: whether the storage line can show in this build. Off in Release until
// the final group 3 PR, which turns it on with the restart and failure notices and
// the storage guard (task 3.10; `yarn check:native-swift` keeps them together).
enum WriteStorageLineRollout {
    static let isOnInRelease = false

    static var isOn: Bool {
        #if DEBUG
        true
        #else
        isOnInRelease
        #endif
    }
}

// sc-5219: "Saving…" and "Still saving to this device. Keep the app open." One
// line for every native screen, in its own window, so it stays visible over
// sheets and rides above the keyboard. It takes real space: the screens below
// end above it, so it covers neither rows nor the Undo bar. It ignores touches.
@MainActor
final class WriteStorageLine {
    private let window: UIWindow
    private let screen = WriteStorageLineController()
    private var observer: AnyCancellable?
    private var shown: String?
    // UIKit has no single signal for "a sheet came or went" or "the tab bar
    // moved", so while the line is up it follows them by looking
    private var follower: Timer?
    private let scene: UIWindowScene

    init(
        status: WriteStorageStatus, scene: UIWindowScene, barHeight: @escaping () -> CGFloat,
        reserve: @escaping (_ height: CGFloat, _ keyboard: CGFloat) -> Void
    ) {
        self.scene = scene
        window = UIWindow(windowScene: scene)
        window.windowLevel = .alert
        window.isUserInteractionEnabled = false
        window.backgroundColor = .clear
        window.rootViewController = screen
        screen.barHeight = barHeight
        screen.onHeight = reserve
        observer = status.shownMessage().sink { [weak self] message in self?.show(message) }
    }

    private func show(_ message: String?) {
        if let words = WriteStorageStatus.announcement(from: shown, to: message) {
            // Queued, so it does not cut across what VoiceOver is reading
            let queued = NSAttributedString(string: words, attributes: [.accessibilitySpeechQueueAnnouncement: true])
            UIAccessibility.post(notification: .announcement, argument: queued)
        }
        shown = message
        screen.show(message)
        follow()
        follower?.invalidate()
        follower = nil
        guard message != nil else { return }
        follower = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.follow() }
        }
    }

    private func follow() {
        // A confirmation sits at the bottom and takes the person's whole attention;
        // the line ignores touches, so it must not lie over its buttons
        window.isHidden = shown == nil || isConfirmationUp
        screen.follow()
    }

    private var isConfirmationUp: Bool {
        var screen = scene.windows.first(where: \.isKeyWindow)?.rootViewController
        while let presented = screen?.presentedViewController {
            if presented is UIAlertController { return true }
            screen = presented
        }
        return false
    }
}

// The view being typed in, wherever it is
private extension UIResponder {
    private static weak var found: UIResponder?

    static var current: UIResponder? {
        found = nil
        UIApplication.shared.sendAction(#selector(noteFirstResponder), to: nil, from: nil, for: nil)
        return found
    }

    @objc private func noteFirstResponder() { UIResponder.found = self }
}

private final class WriteStorageLineController: UIViewController {
    var barHeight: () -> CGFloat = { 0 }
    var onHeight: (_ height: CGFloat, _ keyboard: CGFloat) -> Void = { _, _ in }
    private let pill = UIView()
    private let label = UILabel()
    private var aboveBar: NSLayoutConstraint?
    private var atTop: NSLayoutConstraint?
    private var reserved: CGFloat = 0

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        // DESIGN.native.md: label/primary on the opaque bg/grouped-secondary, with a hairline
        label.font = .preferredFont(forTextStyle: .footnote)
        label.adjustsFontForContentSizeCategory = true
        label.textColor = .label
        label.textAlignment = .center
        label.numberOfLines = 0
        label.accessibilityIdentifier = "storage.line"
        label.translatesAutoresizingMaskIntoConstraints = false
        pill.backgroundColor = .secondarySystemGroupedBackground
        pill.layer.cornerRadius = 8
        pill.layer.borderWidth = 1 / max(traitCollection.displayScale, 1)
        pill.layer.borderColor = UIColor.separator.resolvedColor(with: traitCollection).cgColor
        pill.translatesAutoresizingMaskIntoConstraints = false
        pill.addSubview(label)
        view.addSubview(pill)
        let safe = view.safeAreaLayoutGuide
        let keyboardTop = view.keyboardLayoutGuide.topAnchor
        let resting = pill.bottomAnchor.constraint(equalTo: keyboardTop, constant: -8)
        resting.priority = .defaultLow
        let bar = pill.bottomAnchor.constraint(lessThanOrEqualTo: view.bottomAnchor)
        aboveBar = bar
        atTop = pill.topAnchor.constraint(equalTo: safe.topAnchor, constant: 8)
        NSLayoutConstraint.activate([
            label.topAnchor.constraint(equalTo: pill.topAnchor, constant: 6),
            label.bottomAnchor.constraint(equalTo: pill.bottomAnchor, constant: -6),
            label.leadingAnchor.constraint(equalTo: pill.leadingAnchor, constant: 12),
            label.trailingAnchor.constraint(equalTo: pill.trailingAnchor, constant: -12),
            pill.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            pill.leadingAnchor.constraint(greaterThanOrEqualTo: safe.leadingAnchor, constant: 16),
            pill.trailingAnchor.constraint(lessThanOrEqualTo: safe.trailingAnchor, constant: -16),
            pill.topAnchor.constraint(greaterThanOrEqualTo: safe.topAnchor, constant: 8),
            pill.bottomAnchor.constraint(lessThanOrEqualTo: keyboardTop, constant: -8),
            bar, resting,
        ])
    }

    // A layer's colour does not follow light, dark or Increase Contrast by itself
    override func traitCollectionDidChange(_ previous: UITraitCollection?) {
        super.traitCollectionDidChange(previous)
        pill.layer.borderColor = UIColor.separator.resolvedColor(with: traitCollection).cgColor
    }

    func show(_ message: String?) {
        loadViewIfNeeded()
        label.text = message
    }

    // Puts the line where it belongs now, and gives the screens under it,
    // including a sheet that has just opened, the room it takes
    func follow() {
        guard label.text != nil else {
            if reserved != 0 { onHeight(0, 0) }
            reserved = 0
            return
        }
        aboveBar?.constant = -(barHeight() + 8)
        view.layoutIfNeeded()
        let keyboardTop = view.keyboardLayoutGuide.layoutFrame.minY
        let keyboardIsUp = keyboardTop < view.safeAreaLayoutGuide.layoutFrame.maxY
        let field = (UIResponder.current as? UIView).map { $0.convert($0.bounds, to: view) }
        atTop?.isActive = keyboardIsUp
            && WriteStorageLinePlacement.coversField(field, lineHeight: pill.bounds.height, keyboardTop: keyboardTop)
        view.layoutIfNeeded()
        reserved = pill.bounds.height + 8
        let safeBottom = view.safeAreaLayoutGuide.layoutFrame.maxY
        onHeight(reserved, keyboardIsUp && atTop?.isActive != true ? safeBottom - keyboardTop : 0)
    }
}

// One tab's screen: the shared web view while this tab shows it, or a native
// screen for good
final class TabContainerViewController: UIViewController {
    let section: NativeTab
    var onWillAppear: ((NativeTab) -> Void)?
    private(set) var hostsNativeScreen = false
    private var overlay: UIViewController?
    private var cover: UIViewController?
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

    // Room for the storage line: the screen ends above it, and the strip it
    // sits on matches the grouped page rather than showing as a white band
    func reserveBottom(_ height: CGFloat) {
        additionalSafeAreaInsets.bottom = height
        view.backgroundColor = height > 0 ? .systemGroupedBackground : .systemBackground
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
        install(screen, replacing: &overlay)
        if let cover { view.bringSubviewToFront(cover.view) }
    }

    // A screen over the overlay (the paychecks list over the Budget tab, sc-4309);
    // the overlay below stays as it is
    func setCover(_ screen: UIViewController?) {
        install(screen, replacing: &cover)
    }

    private func install(_ screen: UIViewController?, replacing slot: inout UIViewController?) {
        if let old = slot {
            old.willMove(toParent: nil)
            old.view.removeFromSuperview()
            old.removeFromParent()
        }
        slot = screen
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
        if let cover { view.bringSubviewToFront(cover.view) }
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
