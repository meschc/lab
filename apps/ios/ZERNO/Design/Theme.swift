import SwiftUI

/// Градиентный морфизм: светлая подложка, стеклянные панели,
/// цвет живёт в акцентах и плашках. Светлый мир, тёмной темы нет.
enum Ink {
    static let ground   = Color(red: 0.929, green: 0.929, blue: 0.945)  // #EDEDF1
    static let ground2  = Color(red: 0.969, green: 0.969, blue: 0.976)  // #F7F7F9
    static let text     = Color(red: 0.075, green: 0.075, blue: 0.098)  // #131319
    static let text2    = Color(red: 0.380, green: 0.380, blue: 0.431)  // #61616E
    static let text3    = Color(red: 0.604, green: 0.604, blue: 0.651)  // #9A9AA6
    static let accent   = Color(red: 0.416, green: 0.357, blue: 0.941)  // #6A5BF0
    static let hot      = Color(red: 1.000, green: 0.361, blue: 0.227)  // #FF5C3A
    static let hair     = Color(red: 0.075, green: 0.075, blue: 0.098, opacity: 0.09)

    /// Цвета градиентных плашек.
    static let pink1  = Color(red: 1.000, green: 0.455, blue: 0.769)  // #FF74C4
    static let pink2  = Color(red: 0.651, green: 0.294, blue: 0.878)  // #A64BE0
    static let blue1  = Color(red: 0.357, green: 0.420, blue: 0.941)  // #5B6BF0
    static let blue2  = Color(red: 0.165, green: 0.180, blue: 0.420)  // #2A2E6B
    static let amber1 = Color(red: 1.000, green: 0.663, blue: 0.239)  // #FFA93D
    static let amber2 = Color(red: 0.910, green: 0.325, blue: 0.169)  // #E8532B
    static let cyan1  = Color(red: 0.275, green: 0.847, blue: 0.910)  // #46D8E8

    /// Закатный переход знака: тёплое ядро → коралл → фиолетовая кромка.
    static let markGradient = LinearGradient(
        colors: [Color(red: 1.0, green: 0.541, blue: 0.447),
                 Color(red: 0.824, green: 0.337, blue: 0.620),
                 Color(red: 0.373, green: 0.184, blue: 0.659)],
        startPoint: .topLeading, endPoint: .bottomTrailing)

    /// Основная градиентная заливка кнопок и активных пилюль.
    static let action = LinearGradient(
        colors: [pink2, blue1], startPoint: .topLeading, endPoint: .bottomTrailing)
}

enum Kind {
    /// Засечный остался только логотипу.
    static func display(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .serif)
    }
    /// Моноширинный — краевая печать на плёнке и числа.
    static func mono(_ size: CGFloat, _ weight: Font.Weight = .medium) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }
    static func ui(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight)
    }
}

/// Надпись вразрядку — ярлыки и служебные подписи.
struct Eyebrow: ViewModifier {
    var color: Color = Ink.text3
    func body(content: Content) -> some View {
        content
            .font(Kind.ui(11, .semibold))
            .tracking(1.1)
            .textCase(.uppercase)
            .foregroundStyle(color)
    }
}

/// Стеклянная панель: размытие, подъём насыщенности, светлая кромка.
struct GlassPanel: ViewModifier {
    var radius: CGFloat = 22
    var opacity: Double = 0.58
    func body(content: Content) -> some View {
        content
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .background(Color.white.opacity(opacity),
                        in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.85), lineWidth: 1))
            .shadow(color: Color(red: 0.12, green: 0.11, blue: 0.24, opacity: 0.08), radius: 14, y: 4)
    }
}

extension View {
    func eyebrow(_ color: Color = Ink.text3) -> some View {
        modifier(Eyebrow(color: color))
    }
    func glass(radius: CGFloat = 22, opacity: Double = 0.58) -> some View {
        modifier(GlassPanel(radius: radius, opacity: opacity))
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

/// Цветные пятна под фоном: подложка остаётся спокойной, но не плоской.
struct MeshBackground: View {
    @State private var drift = false

    var body: some View {
        ZStack {
            Ink.ground
            blob(Ink.pink1,  size: 0.62, x: -0.16, y: -0.06, dx:  0.12, dy:  0.08, period: 26)
            blob(Ink.blue1,  size: 0.70, x:  0.62, y:  0.14, dx: -0.10, dy: -0.06, period: 32)
            blob(Ink.amber1, size: 0.58, x:  0.06, y:  0.72, dx:  0.08, dy: -0.10, period: 28)
            blob(Ink.cyan1,  size: 0.52, x:  0.66, y:  0.84, dx: -0.09, dy:  0.05, period: 36)
        }
        .ignoresSafeArea()
        .overlay(
            RadialGradient(colors: [Color.white.opacity(0.42), .clear],
                           center: UnitPoint(x: 0.5, y: 0.34),
                           startRadius: 0, endRadius: 420)
                .ignoresSafeArea()
                .allowsHitTesting(false))
        .onAppear { drift = true }
    }

    private func blob(_ color: Color, size: CGFloat, x: CGFloat, y: CGFloat,
                      dx: CGFloat, dy: CGFloat, period: Double) -> some View {
        GeometryReader { geo in
            let side = geo.size.width * size
            Circle()
                .fill(RadialGradient(colors: [color, color.opacity(0)],
                                     center: .center, startRadius: 0, endRadius: side * 0.5))
                .frame(width: side, height: side)
                .position(x: geo.size.width * (x + size / 2) + (drift ? geo.size.width * dx : 0),
                          y: geo.size.height * y + (drift ? geo.size.height * dy : 0))
                .animation(.easeInOut(duration: period).repeatForever(autoreverses: true), value: drift)
        }
        .blur(radius: 90)
        .opacity(0.34)
        .saturation(0.72)
    }
}

enum Haptics {
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func shutter() { UIImpactFeedbackGenerator(style: .heavy).impactOccurred() }
    static func done() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
}
