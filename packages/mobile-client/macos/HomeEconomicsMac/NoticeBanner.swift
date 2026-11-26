import AppKit

// Fork-only (story 5220). The window's content: the page, with the notice
// strip above it when there is a notice. The strip sits directly under the
// title bar and the page gets the space that is left, so nothing is covered,
// and it stays visible in full screen. It is opaque, in system colours, grows
// when its text wraps, and comes and goes without animation. It never takes
// focus by itself; its Dismiss button is reachable from the keyboard.
final class NoticeContainer: NSView {
    let strip = NoticeStrip()
    let dismissButton = NSButton(title: String(localized: "Dismiss"), target: nil, action: nil)
    var onDismiss: (() -> Void)?

    private let content: NSView
    private let label = NSTextField(wrappingLabelWithString: "")
    private static let padding: CGFloat = 8
    private static let sidePadding: CGFloat = 12

    init(frame: NSRect, content: NSView) {
        self.content = content
        super.init(frame: frame)
        content.autoresizingMask = []
        addSubview(content)
        label.font = .systemFont(ofSize: NSFont.systemFontSize)
        label.textColor = .labelColor
        label.isSelectable = false
        dismissButton.target = self
        dismissButton.action = #selector(dismissPressed)
        dismissButton.controlSize = .small
        dismissButton.refusesFirstResponder = false
        dismissButton.setAccessibilityLabel(String(localized: "Dismiss this notice"))
        strip.addSubview(label)
        strip.addSubview(dismissButton)
        strip.isHidden = true
        addSubview(strip)
    }

    required init?(coder: NSCoder) { nil }

    func show(_ text: String?) {
        label.stringValue = text ?? ""
        strip.isHidden = text == nil
        needsLayout = true
        layoutSubtreeIfNeeded()
    }

    @objc private func dismissPressed() {
        onDismiss?()
    }

    override func layout() {
        super.layout()
        let height = strip.isHidden ? 0 : layoutStrip()
        setFrameIfChanged(content, NSRect(x: 0, y: 0, width: bounds.width, height: max(0, bounds.height - height)))
    }

    // Lays out the strip's contents and returns its height
    private func layoutStrip() -> CGFloat {
        let button = dismissButton.fittingSize
        let labelWidth = max(80, bounds.width - button.width - Self.sidePadding * 3)
        let fitting = NSRect(x: 0, y: 0, width: labelWidth, height: .greatestFiniteMagnitude)
        let labelHeight = ceil(label.cell?.cellSize(forBounds: fitting).height ?? 0)
        let height = max(labelHeight, button.height) + Self.padding * 2
        setFrameIfChanged(strip, NSRect(x: 0, y: bounds.height - height, width: bounds.width, height: height))
        setFrameIfChanged(
            label, NSRect(x: Self.sidePadding, y: (height - labelHeight) / 2, width: labelWidth, height: labelHeight))
        setFrameIfChanged(
            dismissButton,
            NSRect(
                x: bounds.width - button.width - Self.sidePadding, y: (height - button.height) / 2, width: button.width,
                height: button.height))
        return height
    }

    private func setFrameIfChanged(_ view: NSView, _ frame: NSRect) {
        if view.frame != frame { view.frame = frame }
    }
}

final class NoticeStrip: NSView {
    override var isOpaque: Bool { true }
    override var acceptsFirstResponder: Bool { false }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.controlBackgroundColor.setFill()
        dirtyRect.fill()
        NSColor.separatorColor.setFill()
        NSRect(x: 0, y: 0, width: bounds.width, height: 1).fill()
    }
}
