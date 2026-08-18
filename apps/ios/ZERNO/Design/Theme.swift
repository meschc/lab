import SwiftUI

/// Тёмная комната: один визуальный мир, светлой темы нет.
enum Ink {
    static let ground   = Color(red: 0.043, green: 0.039, blue: 0.035)  // #0B0A09
    static let surface  = Color(red: 0.078, green: 0.067, blue: 0.063)  // #141110
    static let rebate   = Color(red: 0.133, green: 0.110, blue: 0.090)  // #221C17
    static let edge     = Color(red: 0.200, green: 0.169, blue: 0.137)  // #332B23
    static let amber    = Color(red: 0.914, green: 0.631, blue: 0.231)  // #E9A13B
    static let amberDim = Color(red: 0.541, green: 0.384, blue: 0.141)  // #8A6224
    static let halation = Color(red: 1.000, green: 0.361, blue: 0.227)  // #FF5C3A
    static let silver   = Color(red: 0.655, green: 0.620, blue: 0.565)  // #A79E90
    static let paper    = Color(red: 0.961, green: 0.937, blue: 0.890)  // #F5EFE3
}

enum Kind {
    /// Заголовки — засечный шрифт, как на обложке фотожурнала.
    static func display(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .serif)
    }
    /// Технические подписи — моноширинный, как краевая печать на плёнке.
    static func mono(_ size: CGFloat, _ weight: Font.Weight = .medium) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }
    static func ui(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight)
    }
}

/// Надпись вразрядку — ярлыки и служебные подписи.
struct Eyebrow: ViewModifier {
    var color: Color = Ink.silver
    func body(content: Content) -> some View {
        content
            .font(Kind.mono(10))
            .tracking(1.6)
            .textCase(.uppercase)
            .foregroundStyle(color)
    }
}

extension View {
    func eyebrow(_ color: Color = Ink.silver) -> some View {
        modifier(Eyebrow(color: color))
    }

    /// Мягкий отклик на нажатие — кнопка «проседает» под пальцем.
    func pressable(scale: CGFloat = 0.94) -> some View {
        buttonStyle(PressStyle(scale: scale))
    }
}

struct PressStyle: ButtonStyle {
    var scale: CGFloat = 0.94
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1)
            .animation(.spring(response: 0.28, dampingFraction: 0.55), value: configuration.isPressed)
    }
}

enum Haptics {
    static func tap() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }
    static func shutter() {
        UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
    }
    static func done() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }
}
