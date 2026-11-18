import AppKit

// Fork-only (story 5220). The strip that shows a WindowNotice at the top of
// the main window, over the page. It never takes focus and lets clicks
// through to the page, so it blocks nothing.
final class NoticeBanner: NSVisualEffectView {
    private let label = NSTextField(wrappingLabelWithString: "")

    override init(frame: NSRect) {
        super.init(frame: frame)
        material = .popover
        blendingMode = .withinWindow
        state = .active
        wantsLayer = true
        layer?.cornerRadius = 8
        isHidden = true
        label.font = .systemFont(ofSize: NSFont.systemFontSize)
        label.translatesAutoresizingMaskIntoConstraints = false
        addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12),
            label.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12),
            label.topAnchor.constraint(equalTo: topAnchor, constant: 8),
            label.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -8),
        ])
        setAccessibilityElement(false)
    }

    required init?(coder: NSCoder) { nil }

    func show(_ text: String?) {
        label.stringValue = text ?? ""
        isHidden = text == nil
    }

    override var acceptsFirstResponder: Bool { false }
    // Clicks go through to the page underneath
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}
