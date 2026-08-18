import SwiftUI

/// Заставка: диафрагма раскрывается, свет заливает отверстие, проступает имя.
struct SplashView: View {
    @State private var open: CGFloat = 0
    @State private var letters = false
    @State private var subtitle = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let title = Array("ЗЕРНО")

    var body: some View {
        ZStack {
            MeshBackground()
            // мягкая многоцветная подсветка под знаком
            RadialGradient(colors: [Ink.pink1.opacity(0.55), Ink.blue1.opacity(0.35), .clear],
                           center: .center, startRadius: 0, endRadius: 200)
                .frame(width: 380, height: 380)
                .blur(radius: 58)
                .opacity(0.30 + 0.16 * open)
                .offset(y: -70)
            VStack(spacing: 30) {
                ApertureMark(open: open)
                    .frame(width: 146, height: 146)
                    .shadow(color: Color(red: 0.24, green: 0.16, blue: 0.47,
                                         opacity: 0.34 * open), radius: 48, y: 24)

                HStack(spacing: 0) {
                    ForEach(Array(title.enumerated()), id: \.offset) { index, ch in
                        Text(String(ch))
                            .font(Kind.display(52, .heavy))
                            .tracking(14)
                            .foregroundStyle(Ink.text)
                            .offset(y: letters ? 0 : 70)
                            .opacity(letters ? 1 : 0)
                            .animation(.spring(response: 0.7, dampingFraction: 0.8)
                                .delay(0.42 + Double(index) * 0.08), value: letters)
                    }
                }
                .padding(.leading, 14)

                Text("Плёночная лаборатория · 12 эмульсий")
                    .eyebrow()
                    .opacity(subtitle ? 1 : 0)
                    .animation(.easeOut(duration: 0.8).delay(1.05), value: subtitle)
            }
        }
        .onAppear {
            if reduceMotion {
                open = 1; letters = true; subtitle = true
            } else {
                withAnimation(.timingCurve(0.22, 1, 0.36, 1, duration: 1.25)) { open = 1 }
                letters = true
                subtitle = true
            }
        }
    }
}
