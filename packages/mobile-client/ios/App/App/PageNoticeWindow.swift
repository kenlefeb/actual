import UIKit

// Fork-only (sc-5220). Shows the app's one notice in a strip at the top of the
// screen. It has its own window so it stays visible over sheets, and that
// window is never made key, so the notice takes no focus. Only the strip takes
// touches. `reserve` moves the screens below it down, so it covers nothing.
@MainActor
final class PageNoticeWindow {
    private let window: PassThroughWindow
    private let screen = PageNoticeController()

    init(notices: WindowNotices, scene: UIWindowScene, mainWindow: UIWindow, reserve: @escaping (CGFloat) -> Void) {
        window = PassThroughWindow(windowScene: scene)
        window.windowLevel = .normal + 1
        window.backgroundColor = .clear
        window.rootViewController = screen
        screen.onHeight = reserve
        screen.onDismiss = { [weak notices] in notices?.clear() }
        mainWindow.addGestureRecognizer(TouchWatcher { [weak notices] in notices?.noteInput() })
        notices.onChange = { [weak self] in self?.show($0) }
        show(notices.current)
    }

    private func show(_ notice: WindowNotice?) {
        window.isHidden = notice == nil
        screen.show(notice?.text)
    }
}

private final class PassThroughWindow: UIWindow {
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let view = super.hitTest(point, with: event)
        return view === rootViewController?.view ? nil : view
    }
}

// Sees touches on the screens below and leaves them alone. Hiding the strip
// moves the page, so it waits for the finger.
// shortcut: keys on the keyboard are another window and don't count; watch them
// too if hiding while typing shows up as a problem.
private final class TouchWatcher: UIGestureRecognizer, UIGestureRecognizerDelegate {
    private let onTouch: () -> Void

    init(onTouch: @escaping () -> Void) {
        self.onTouch = onTouch
        super.init(target: nil, action: nil)
        cancelsTouchesInView = false
        delaysTouchesBegan = false
        delaysTouchesEnded = false
        delegate = self
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) { onTouch() }
    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) { onTouch() }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        onTouch()
        state = .failed
    }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) { state = .failed }

    func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        true
    }
}

private final class PageNoticeController: UIViewController {
    var onHeight: (CGFloat) -> Void = { _ in }
    var onDismiss: () -> Void = {}
    private let strip = UIView()
    private let stack = UIStackView()
    private let label = UILabel()
    private let dismiss = UIButton(configuration: .plain())
    private var reserved: CGFloat = -1

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        // DESIGN.native.md: label/primary on the opaque bg/grouped-secondary, with a hairline
        strip.backgroundColor = .secondarySystemGroupedBackground
        strip.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(strip)
        let hairline = UIView()
        hairline.backgroundColor = .separator
        hairline.translatesAutoresizingMaskIntoConstraints = false
        strip.addSubview(hairline)

        label.font = .preferredFont(forTextStyle: .subheadline)
        label.adjustsFontForContentSizeCategory = true
        label.textColor = .label
        label.numberOfLines = 0
        label.accessibilityIdentifier = "pageNotice.text"
        label.translatesAutoresizingMaskIntoConstraints = false
        // Scrolls only when the text can't fit, so Dismiss always stays on screen
        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(label)

        dismiss.configuration?.title = NSLocalizedString("Dismiss", comment: "Button: close the notice")
        dismiss.configuration?.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer {
            var attributes = $0
            attributes.font = UIFont.preferredFont(forTextStyle: .subheadline)
            return attributes
        }
        dismiss.tintColor = NativeTabBarController.accent
        dismiss.accessibilityLabel = NSLocalizedString("Dismiss this notice", comment: "VoiceOver: the notice's Dismiss button")
        dismiss.accessibilityIdentifier = "pageNotice.dismiss"
        dismiss.addAction(UIAction { [weak self] _ in self?.onDismiss() }, for: .touchUpInside)
        dismiss.setContentHuggingPriority(.required, for: .horizontal)
        dismiss.setContentCompressionResistancePriority(.required, for: .horizontal)
        dismiss.setContentCompressionResistancePriority(.required, for: .vertical)

        stack.spacing = 8
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.addArrangedSubview(scroll)
        stack.addArrangedSubview(dismiss)
        strip.addSubview(stack)

        let safe = view.safeAreaLayoutGuide
        let fullHeight = scroll.heightAnchor.constraint(equalTo: scroll.contentLayoutGuide.heightAnchor)
        fullHeight.priority = .defaultHigh
        NSLayoutConstraint.activate([
            strip.topAnchor.constraint(equalTo: view.topAnchor),
            strip.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            strip.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            strip.bottomAnchor.constraint(lessThanOrEqualTo: view.keyboardLayoutGuide.topAnchor),
            hairline.leadingAnchor.constraint(equalTo: strip.leadingAnchor),
            hairline.trailingAnchor.constraint(equalTo: strip.trailingAnchor),
            hairline.bottomAnchor.constraint(equalTo: strip.bottomAnchor),
            hairline.heightAnchor.constraint(equalToConstant: 1 / max(traitCollection.displayScale, 1)),
            stack.topAnchor.constraint(equalTo: safe.topAnchor, constant: 8),
            stack.bottomAnchor.constraint(equalTo: strip.bottomAnchor, constant: -8),
            stack.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -16),
            dismiss.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
            label.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            label.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
            label.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
            label.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
            label.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor),
            fullHeight,
        ])
    }

    func show(_ text: String?) {
        loadViewIfNeeded()
        label.text = text
        strip.isHidden = text == nil
        view.setNeedsLayout()
        view.layoutIfNeeded()
        report()
    }

    override func viewWillLayoutSubviews() {
        super.viewWillLayoutSubviews()
        // At accessibility sizes the text needs the full width
        let isLarge = traitCollection.preferredContentSizeCategory.isAccessibilityCategory
        stack.axis = isLarge ? .vertical : .horizontal
        stack.alignment = isLarge ? .fill : .center
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        report()
    }

    private func report() {
        let height = strip.isHidden ? 0 : strip.frame.maxY - view.safeAreaInsets.top
        guard height != reserved else { return }
        reserved = height
        onHeight(height)
    }
}
